#!/usr/bin/env node
"use strict";

const path = require("path");
const { compress } = require("./src/compress");
const { decompress } = require("./src/decompress");

// ---------------------------------------------------------------------------
// CLI — Compressor/Descompressor PPM-C + Codificação Aritmética
//
// Uso:
//   node index.js compress   <input> <output> [opções]
//   node index.js decompress <input> <output>
//
// Opções de compressão:
//   --order=N          Ordem máxima do modelo PPM-C (default: 5)
//   --window=N         Tamanho da janela de monitoramento (default: 1000)
//   --threshold=N      Aumento percentual para reset, ex: 0.15 = 15% (default: 0.15)
//   --log=FILE         Caminho para salvar CSV com métricas
// ---------------------------------------------------------------------------

function printUsage() {
  console.log(`
PPM-C Compressor/Descompressor
==============================

Uso:
  node index.js compress   <input> <output> [opções]
  node index.js decompress <input> <output>

Opções de compressão:
  --order=N       Ordem máxima do PPM-C (default: 5)
  --window=N      Janela de monitoramento em símbolos (default: 1000)
  --threshold=N   Limiar de reset, fração decimal (default: 0.15)
  --log=FILE      Gerar CSV com métricas de compressão

Exemplos:
  node index.js compress   teste.txt teste.ppm --order=5 --log=metricas.csv
  node index.js decompress teste.ppm  teste_restaurado.txt
`);
}

function parseArgs(args) {
  const opts = {};
  const positional = [];
  for (const arg of args) {
    if (arg.startsWith("--")) {
      const [key, val] = arg.slice(2).split("=");
      opts[key] = val;
    } else {
      positional.push(arg);
    }
  }
  return { positional, opts };
}

const args = process.argv.slice(2);

if (args.length < 1) {
  printUsage();
  process.exit(1);
}

const command = args[0];
const { positional, opts } = parseArgs(args.slice(1));

if (command === "compress" || command === "c") {
  if (positional.length < 2) {
    console.error("Erro: forneça <input> e <output>");
    printUsage();
    process.exit(1);
  }
  const inputPath  = path.resolve(positional[0]);
  const outputPath = path.resolve(positional[1]);

  const compressOpts = {
    maxOrder:       opts.order     ? parseInt(opts.order, 10)    : 5,
    windowSize:     opts.window    ? parseInt(opts.window, 10)   : 1000,
    resetThreshold: opts.threshold ? parseFloat(opts.threshold)  : 0.15,
    logPath:        opts.log       ? path.resolve(opts.log)      : null,
  };

  console.log(`Comprimindo "${inputPath}" → "${outputPath}"`);
  console.log(`  Ordem máx: ${compressOpts.maxOrder}, Janela: ${compressOpts.windowSize}, Limiar reset: ${(compressOpts.resetThreshold * 100).toFixed(1)}%`);

  const t0 = Date.now();
  compress(inputPath, outputPath, compressOpts);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`  Tempo: ${elapsed}s`);

} else if (command === "decompress" || command === "d") {
  if (positional.length < 2) {
    console.error("Erro: forneça <input> e <output>");
    printUsage();
    process.exit(1);
  }
  const inputPath  = path.resolve(positional[0]);
  const outputPath = path.resolve(positional[1]);

  console.log(`Descomprimindo "${inputPath}" → "${outputPath}"`);

  const t0 = Date.now();
  decompress(inputPath, outputPath);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`  Tempo: ${elapsed}s`);

} else {
  console.error(`Comando desconhecido: "${command}"`);
  printUsage();
  process.exit(1);
}
