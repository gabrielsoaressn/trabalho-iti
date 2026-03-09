"use strict";

// ---------------------------------------------------------------------------
// Modelo PPM-C (Prediction by Partial Matching — Variante C)
//
// - Contextos de ordem 0 até maxOrder.
// - Escape PPM-C: contagem do escape = número de símbolos únicos no contexto.
// - Exclusão obrigatória: ao dar escape no nível K, os símbolos já tentados
//   são excluídos dos cálculos nos níveis inferiores.
// - Ordem -1: distribuição uniforme sobre o alfabeto (256 símbolos + EOF).
// ---------------------------------------------------------------------------

const ALPHABET_SIZE = 257; // 0..255 + EOF (256)
const EOF_SYMBOL = 256;

class PPMModel {
  /**
   * @param {number} maxOrder — ordem máxima dos contextos (ex: 5)
   */
  constructor(maxOrder) {
    this.maxOrder = maxOrder;
    this.contexts = new Map(); // chave: string do contexto → { counts: Map<symbol, count> }
  }

  /** Limpa todas as tabelas (reset total). */
  reset() {
    this.contexts.clear();
  }

  /**
   * Retorna a chave de contexto para uma dada ordem e histórico.
   * O histórico é um array dos últimos maxOrder bytes processados.
   *
   * @param {number[]} history — últimos bytes processados
   * @param {number} order    — ordem do contexto desejado
   * @returns {string}
   */
  _contextKey(history, order) {
    if (order === 0) return "";
    const start = history.length - order;
    return history.slice(start).join(",");
  }

  /**
   * Obtém (ou cria) o nó de contexto.
   * @returns {{ counts: Map<number, number> }}
   */
  _getNode(key) {
    let node = this.contexts.get(key);
    if (!node) {
      node = { counts: new Map() };
      this.contexts.set(key, node);
    }
    return node;
  }

  /**
   * Codifica um símbolo: percorre do nível maxOrder até -1, emitindo
   * escape quando o símbolo não é encontrado (ou primeira vez no contexto).
   *
   * Retorna array de intervalos { cumLow, cumHigh, total } que o
   * codificador aritmético deve processar em sequência.
   *
   * @param {number}   symbol  — símbolo a codificar (0-256)
   * @param {number[]} history — últimos bytes já processados
   * @returns {{ cumLow: number, cumHigh: number, total: number }[]}
   */
  encode(symbol, history) {
    const intervals = [];
    const excluded = new Set(); // símbolos a excluir (mecanismo de exclusão)

    for (let order = Math.min(this.maxOrder, history.length); order >= 0; order--) {
      const key = this._contextKey(history, order);
      const node = this._getNode(key);

      const result = this._tryEncode(node, symbol, excluded);

      if (result.found) {
        intervals.push(result.interval);
        // Atualiza contagens em todos os contextos de 0..maxOrder
        this._updateCounts(symbol, history);
        return intervals;
      }

      // Escape: emite o intervalo do escape e adiciona símbolos ao excluded
      intervals.push(result.escapeInterval);
      for (const s of node.counts.keys()) {
        excluded.add(s);
      }
    }

    // Ordem -1: distribuição uniforme (sempre encontra)
    intervals.push(this._encodeOrderMinus1(symbol, excluded));
    this._updateCounts(symbol, history);
    return intervals;
  }

  /**
   * Decodifica: para cada nível, retorna as informações para o decoder
   * descobrir qual símbolo foi codificado.
   *
   * Retorna um objeto com:
   *  - order: a ordem onde o símbolo foi encontrado (-1 se caiu até lá)
   *  - symbol: o símbolo decodificado
   *  - intervals: os intervalos de escape emitidos antes (se houver)
   *
   * Esta função é usada de forma interativa com o ArithmeticDecoder.
   * O chamador deve, para cada nível:
   *   1) Obter total → chamar decoder.getCount(total)
   *   2) Identificar símbolo ou escape
   *   3) Chamar decoder.decode(cumLow, cumHigh, total)
   */

  /**
   * Para uma dada ordem e conjunto de exclusão, retorna:
   * { total, symbols: [{ symbol, cumLow, cumHigh }], escape: { cumLow, cumHigh } | null }
   *
   * Se o contexto está vazio (nenhum símbolo visto), retorna null (saltar direto).
   */
  getDistribution(history, order, excluded) {
    if (order < 0) {
      return this._getOrderMinus1Distribution(excluded);
    }

    const key = this._contextKey(history, order);
    const node = this.contexts.get(key);

    if (!node || node.counts.size === 0) {
      return null; // contexto vazio, pular direto para ordem inferior
    }

    // Calcula total excluindo símbolos do set excluded
    let totalCount = 0;
    let uniqueCount = 0; // para o escape PPM-C (nº de únicos NÃO excluídos... mas escape = únicos totais)

    // PPM-C: escape count = número de símbolos únicos NO CONTEXTO (não muda com exclusão)
    const escapeCount = node.counts.size;

    // Somar contagens dos símbolos não excluídos
    const activeSymbols = [];
    for (const [s, c] of node.counts) {
      if (!excluded.has(s)) {
        totalCount += c;
        activeSymbols.push({ symbol: s, count: c });
      }
    }

    if (activeSymbols.length === 0) {
      // Todos os símbolos deste contexto já foram excluídos → pular
      return null;
    }

    const total = totalCount + escapeCount;

    // Construir intervalos cumulativos (símbolos ordenados para determinismo)
    activeSymbols.sort((a, b) => a.symbol - b.symbol);

    let cum = 0;
    const symbols = [];
    for (const { symbol, count } of activeSymbols) {
      symbols.push({ symbol, cumLow: cum, cumHigh: cum + count });
      cum += count;
    }

    // Escape ocupa [cum, cum + escapeCount)
    const escape = { cumLow: cum, cumHigh: cum + escapeCount };

    return { total, symbols, escape };
  }

  /**
   * Distribuição uniforme na ordem -1.
   * Todos os 257 símbolos (0..256) com peso 1, excluindo os do set.
   */
  _getOrderMinus1Distribution(excluded) {
    const symbols = [];
    let cum = 0;
    for (let s = 0; s < ALPHABET_SIZE; s++) {
      if (!excluded.has(s)) {
        symbols.push({ symbol: s, cumLow: cum, cumHigh: cum + 1 });
        cum++;
      }
    }
    return { total: cum, symbols, escape: null };
  }

  /**
   * Tenta codificar o símbolo no nó dado com exclusão.
   * Retorna { found, interval?, escapeInterval? }
   */
  _tryEncode(node, symbol, excluded) {
    if (node.counts.size === 0) {
      // Contexto vazio → escape implícito (pular)
      return { found: false, escapeInterval: null };
    }

    const escapeCount = node.counts.size; // PPM-C

    // Calcular total e posição do símbolo (excluindo excluded)
    let totalCount = 0;
    const activeSymbols = [];
    for (const [s, c] of node.counts) {
      if (!excluded.has(s)) {
        totalCount += c;
        activeSymbols.push({ symbol: s, count: c });
      }
    }

    if (activeSymbols.length === 0) {
      // Todos excluídos → pular
      return { found: false, escapeInterval: null };
    }

    const total = totalCount + escapeCount;
    activeSymbols.sort((a, b) => a.symbol - b.symbol);

    // Procurar o símbolo
    let cum = 0;
    for (const { symbol: s, count } of activeSymbols) {
      if (s === symbol) {
        return {
          found: true,
          interval: { cumLow: cum, cumHigh: cum + count, total }
        };
      }
      cum += count;
    }

    // Símbolo não encontrado (ou está excluído) → escape
    const escapeInterval = { cumLow: cum, cumHigh: cum + escapeCount, total };
    return { found: false, escapeInterval };
  }

  /** Codifica na ordem -1. */
  _encodeOrderMinus1(symbol, excluded) {
    let cum = 0;
    for (let s = 0; s < ALPHABET_SIZE; s++) {
      if (excluded.has(s)) continue;
      if (s === symbol) {
        return { cumLow: cum, cumHigh: cum + 1, total: ALPHABET_SIZE - excluded.size };
      }
      cum++;
    }
    // Nunca deve chegar aqui
    throw new Error(`Símbolo ${symbol} não encontrado na ordem -1`);
  }

  /**
   * Atualiza as contagens em todos os contextos relevantes (0..maxOrder).
   */
  _updateCounts(symbol, history) {
    for (let order = 0; order <= Math.min(this.maxOrder, history.length); order++) {
      const key = this._contextKey(history, order);
      const node = this._getNode(key);
      node.counts.set(symbol, (node.counts.get(symbol) || 0) + 1);
    }
  }

  /**
   * Busca um símbolo dado o valor cumulativo numa distribuição.
   * Usado pelo decodificador.
   *
   * @param {{ total, symbols, escape }} dist
   * @param {number} count — valor retornado por decoder.getCount(total)
   * @returns {{ symbol: number|null, cumLow: number, cumHigh: number, isEscape: boolean }}
   */
  findSymbol(dist, count) {
    // Verificar nos símbolos
    for (const entry of dist.symbols) {
      if (count >= entry.cumLow && count < entry.cumHigh) {
        return { symbol: entry.symbol, cumLow: entry.cumLow, cumHigh: entry.cumHigh, isEscape: false };
      }
    }
    // É escape
    if (dist.escape && count >= dist.escape.cumLow && count < dist.escape.cumHigh) {
      return { symbol: null, cumLow: dist.escape.cumLow, cumHigh: dist.escape.cumHigh, isEscape: true };
    }
    throw new Error(`findSymbol: count=${count} não encontrado na distribuição (total=${dist.total})`);
  }
}

module.exports = { PPMModel, EOF_SYMBOL, ALPHABET_SIZE };
