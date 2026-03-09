"use strict";

const fs = require("fs");
const { BitWriter } = require("./bitstream");
const { ArithmeticEncoder } = require("./arithmetic");
const { PPMModel, EOF_SYMBOL } = require("./ppm-model");

/**
 * Calcula os bits de informação de um intervalo aritmético.
 * Ambos compressor e descompressor usam esta fórmula para manter sincronia.
 */
function intervalBits(cumLow, cumHigh, total) {
  return -Math.log2((cumHigh - cumLow) / total);
}

/**
 * Comprime um arquivo usando PPM-C + Codificação Aritmética.
 *
 * @param {string} inputPath    — caminho do arquivo de entrada
 * @param {string} outputPath   — caminho do arquivo comprimido
 * @param {object} opts
 * @param {number} opts.maxOrder       — ordem máxima do modelo (default: 5)
 * @param {number} opts.windowSize     — janela para monitorar taxa (default: 1000)
 * @param {number} opts.resetThreshold — aumento percentual para reset (default: 0.15 = 15%)
 * @param {string} opts.logPath        — caminho do CSV de log (opcional)
 */
function compress(inputPath, outputPath, opts = {}) {
  const maxOrder       = opts.maxOrder       ?? 5;
  const windowSize     = opts.windowSize     ?? 1000;
  const resetThreshold = opts.resetThreshold ?? 0.15;
  const logPath        = opts.logPath        || null;

  const inputData = fs.readFileSync(inputPath);
  const inputSize = inputData.length;

  const writer  = new BitWriter(outputPath);
  const encoder = new ArithmeticEncoder(writer);
  const model   = new PPMModel(maxOrder);

  // Gravar header: tamanho original (4 bytes) + maxOrder (1 byte)
  // + windowSize (4 bytes) + resetThreshold como inteiro (2 bytes, x10000)
  writer.writeBits((inputSize >>> 24) & 0xFF, 8);
  writer.writeBits((inputSize >>> 16) & 0xFF, 8);
  writer.writeBits((inputSize >>>  8) & 0xFF, 8);
  writer.writeBits( inputSize         & 0xFF, 8);
  writer.writeBits(maxOrder, 8);
  writer.writeBits((windowSize >>> 24) & 0xFF, 8);
  writer.writeBits((windowSize >>> 16) & 0xFF, 8);
  writer.writeBits((windowSize >>>  8) & 0xFF, 8);
  writer.writeBits( windowSize         & 0xFF, 8);
  const threshInt = Math.round(resetThreshold * 10000);
  writer.writeBits((threshInt >>> 8) & 0xFF, 8);
  writer.writeBits( threshInt        & 0xFF, 8);

  const history = [];

  // Monitoramento de taxa via bits de informação (sincronizado com descompressor)
  let virtualBits = 0;            // acumulador de -log2(prob) de todos os intervalos
  let windowStartBits = 0;        // virtualBits no início da janela atual
  let prevWindowRate = Infinity;
  let symbolsInWindow = 0;
  let dataSymbolsProcessed = 0;   // conta apenas bytes de dados (não EOF)

  // Log
  let logLines = null;
  if (logPath) {
    logLines = ["n_simbolos_processados,comprimento_medio_progressivo"];
  }

  for (let i = 0; i <= inputSize; i++) {
    const symbol = (i < inputSize) ? inputData[i] : EOF_SYMBOL;

    // Codificar e acumular bits de informação
    const intervals = model.encode(symbol, history);
    for (const iv of intervals) {
      if (iv !== null) {
        encoder.encode(iv.cumLow, iv.cumHigh, iv.total);
        virtualBits += intervalBits(iv.cumLow, iv.cumHigh, iv.total);
      }
    }

    // Atualizar histórico (apenas bytes de dados)
    if (symbol !== EOF_SYMBOL) {
      history.push(symbol);
      if (history.length > maxOrder) {
        history.shift();
      }

      dataSymbolsProcessed++;
      symbolsInWindow++;

      // Log a cada 100 símbolos de dados
      if (logLines && dataSymbolsProcessed % 100 === 0) {
        const avgRate = virtualBits / dataSymbolsProcessed;
        logLines.push(`${dataSymbolsProcessed},${avgRate.toFixed(6)}`);
      }

      // Monitoramento de taxa para reset dinâmico
      if (symbolsInWindow >= windowSize) {
        const bitsInWindow = virtualBits - windowStartBits;
        const currentRate = bitsInWindow / symbolsInWindow;

        if (prevWindowRate !== Infinity && currentRate > prevWindowRate * (1 + resetThreshold)) {
          model.reset();
          history.length = 0;
          if (logLines) {
            logLines.push(`# RESET at symbol ${dataSymbolsProcessed}`);
          }
        }

        prevWindowRate = currentRate;
        windowStartBits = virtualBits;
        symbolsInWindow = 0;
      }
    }
  }

  encoder.finish();
  writer.flush();

  if (logPath && logLines) {
    fs.writeFileSync(logPath, logLines.join("\n") + "\n");
  }

  const compressedSize = fs.statSync(outputPath).size;
  const ratio = ((compressedSize / inputSize) * 100).toFixed(2);
  console.log(`Compressão concluída:`);
  console.log(`  Original:   ${inputSize} bytes`);
  console.log(`  Comprimido: ${compressedSize} bytes`);
  console.log(`  Taxa:       ${ratio}%`);
  if (logPath) {
    console.log(`  Log CSV:    ${logPath}`);
  }
}

module.exports = { compress };
