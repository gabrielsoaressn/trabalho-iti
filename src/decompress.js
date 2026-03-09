"use strict";

const fs = require("fs");
const { BitReader } = require("./bitstream");
const { ArithmeticDecoder } = require("./arithmetic");
const { PPMModel, EOF_SYMBOL } = require("./ppm-model");

/**
 * Calcula os bits de informação de um intervalo aritmético.
 * Mesma fórmula usada pelo compressor — garante sincronia.
 */
function intervalBits(cumLow, cumHigh, total) {
  return -Math.log2((cumHigh - cumLow) / total);
}

/**
 * Descomprime um arquivo gerado pelo compressor PPM-C.
 *
 * O descompressor reconstrói EXATAMENTE a mesma lógica de reset dinâmico
 * do compressor usando bits de informação (-log2(prob)), que são idênticos
 * em ambos os lados pois derivam das mesmas distribuições do modelo PPM-C.
 *
 * @param {string} inputPath  — caminho do arquivo comprimido
 * @param {string} outputPath — caminho do arquivo descomprimido
 */
function decompress(inputPath, outputPath) {
  const reader = new BitReader(inputPath);

  // Ler header
  const inputSize =
    (reader.readBits(8) << 24) |
    (reader.readBits(8) << 16) |
    (reader.readBits(8) <<  8) |
     reader.readBits(8);
  const maxOrder = reader.readBits(8);
  const windowSize =
    (reader.readBits(8) << 24) |
    (reader.readBits(8) << 16) |
    (reader.readBits(8) <<  8) |
     reader.readBits(8);
  const threshInt = (reader.readBits(8) << 8) | reader.readBits(8);
  const resetThreshold = threshInt / 10000;

  const decoder = new ArithmeticDecoder(reader);
  const model   = new PPMModel(maxOrder);

  const output = Buffer.alloc(inputSize);
  const history = [];

  // Monitoramento de taxa sincronizado (mesmas variáveis do compressor)
  let virtualBits = 0;
  let windowStartBits = 0;
  let prevWindowRate = Infinity;
  let symbolsInWindow = 0;

  let outputPos = 0;

  for (;;) {
    // Decodificar um símbolo percorrendo os níveis do PPM-C
    const excluded = new Set();
    let symbol = null;
    const startOrder = Math.min(maxOrder, history.length);

    for (let order = startOrder; order >= -1; order--) {
      const dist = model.getDistribution(history, order, excluded);

      if (dist === null) {
        // Contexto vazio → pular para próxima ordem (mesmo que compressor)
        continue;
      }

      const count = decoder.getCount(dist.total);
      const result = model.findSymbol(dist, count);

      decoder.decode(result.cumLow, result.cumHigh, dist.total);
      virtualBits += intervalBits(result.cumLow, result.cumHigh, dist.total);

      if (result.isEscape) {
        for (const entry of dist.symbols) {
          excluded.add(entry.symbol);
        }
        continue;
      }

      symbol = result.symbol;
      break;
    }

    if (symbol === null) {
      throw new Error("Falha na decodificação: símbolo não encontrado em nenhum nível");
    }

    if (symbol === EOF_SYMBOL) {
      break;
    }

    output[outputPos++] = symbol;

    // Atualizar modelo e histórico (mesma ordem que compressor)
    model._updateCounts(symbol, history);
    history.push(symbol);
    if (history.length > maxOrder) {
      history.shift();
    }

    symbolsInWindow++;

    // Reset dinâmico sincronizado (mesma lógica exata do compressor)
    if (symbolsInWindow >= windowSize) {
      const bitsInWindow = virtualBits - windowStartBits;
      const currentRate = bitsInWindow / symbolsInWindow;

      if (prevWindowRate !== Infinity && currentRate > prevWindowRate * (1 + resetThreshold)) {
        model.reset();
        history.length = 0;
      }

      prevWindowRate = currentRate;
      windowStartBits = virtualBits;
      symbolsInWindow = 0;
    }
  }

  fs.writeFileSync(outputPath, output.slice(0, outputPos));
  console.log(`Descompressão concluída:`);
  console.log(`  Tamanho restaurado: ${outputPos} bytes`);
}

module.exports = { decompress };
