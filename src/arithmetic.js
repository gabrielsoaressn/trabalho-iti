"use strict";

// ---------------------------------------------------------------------------
// Codificação Aritmética com inteiros de 32 bits.
//
// Usa uma janela de precisão de NUM_BITS bits.
// Renormalização: quando os MSBs de low e high coincidem, emite o bit e
// faz shift. Trata underflow (near-convergence / bits pendentes) quando
// low e high estão próximos mas ainda não convergem no MSB.
// ---------------------------------------------------------------------------

const NUM_BITS = 31;                       // bits de precisão (cabe em 32-bit int)
const WHOLE   = (1 << NUM_BITS) >>> 0;     // 2^31
const HALF    = (WHOLE >>> 1);             // 2^30  — ponto médio
const QUARTER = (HALF >>> 1);             // 2^29

// ---------------------------------------------------------------------------
// ArithmeticEncoder
// ---------------------------------------------------------------------------
class ArithmeticEncoder {
  /**
   * @param {import('./bitstream').BitWriter} bitWriter
   */
  constructor(bitWriter) {
    this.writer = bitWriter;
    this.low  = 0;
    this.high = WHOLE - 1;     // tudo dentro de [0, WHOLE)
    this.pending = 0;          // bits pendentes de underflow
  }

  /**
   * Codifica um símbolo dado o intervalo cumulativo [cumLow, cumHigh)
   * dentro do total `total`.
   *
   * @param {number} cumLow  — limite inferior cumulativo (inclusive)
   * @param {number} cumHigh — limite superior cumulativo (exclusive)
   * @param {number} total   — soma total de frequências
   */
  encode(cumLow, cumHigh, total) {
    const range = this.high - this.low + 1;
    this.high = (this.low + Math.floor(range * cumHigh / total) - 1) >>> 0;
    this.low  = (this.low + Math.floor(range * cumLow  / total))     >>> 0;
    this._renormalize();
  }

  /** Finaliza a codificação emitindo bits suficientes para desambiguar. */
  finish() {
    this.pending++;
    if (this.low < QUARTER) {
      this._emitBitPlusPending(0);
    } else {
      this._emitBitPlusPending(1);
    }
  }

  // --- internals ---

  _renormalize() {
    for (;;) {
      if (this.high < HALF) {
        // Ambos em [0, HALF): MSB = 0
        this._emitBitPlusPending(0);
        this.low  = (this.low  << 1) >>> 0;
        this.high = ((this.high << 1) | 1) >>> 0;
      } else if (this.low >= HALF) {
        // Ambos em [HALF, WHOLE): MSB = 1
        this._emitBitPlusPending(1);
        this.low  = ((this.low  - HALF) << 1) >>> 0;
        this.high = (((this.high - HALF) << 1) | 1) >>> 0;
      } else if (this.low >= QUARTER && this.high < 3 * QUARTER) {
        // Underflow: estão próximos do meio
        this.pending++;
        this.low  = ((this.low  - QUARTER) << 1) >>> 0;
        this.high = (((this.high - QUARTER) << 1) | 1) >>> 0;
      } else {
        break;
      }
    }
  }

  _emitBitPlusPending(bit) {
    this.writer.writeBit(bit);
    while (this.pending > 0) {
      this.writer.writeBit(bit ^ 1);
      this.pending--;
    }
  }
}

// ---------------------------------------------------------------------------
// ArithmeticDecoder
// ---------------------------------------------------------------------------
class ArithmeticDecoder {
  /**
   * @param {import('./bitstream').BitReader} bitReader
   */
  constructor(bitReader) {
    this.reader = bitReader;
    this.low    = 0;
    this.high   = WHOLE - 1;
    this.value  = 0;
    // Carrega os primeiros NUM_BITS bits no value
    for (let i = 0; i < NUM_BITS; i++) {
      this.value = (this.value << 1) | this.reader.readBit();
    }
  }

  /**
   * Dado o total de frequências, retorna o valor cumulativo que
   * identifica o símbolo correto. O chamador deve mapear esse valor
   * ao símbolo e depois chamar decode() com os limites.
   *
   * @param {number} total
   * @returns {number} valor cumulativo em [0, total)
   */
  getCount(total) {
    const range = this.high - this.low + 1;
    const offset = this.value - this.low;
    return Math.floor(((offset + 1) * total - 1) / range);
  }

  /**
   * Atualiza o estado interno após identificar o símbolo.
   *
   * @param {number} cumLow
   * @param {number} cumHigh
   * @param {number} total
   */
  decode(cumLow, cumHigh, total) {
    const range = this.high - this.low + 1;
    this.high = (this.low + Math.floor(range * cumHigh / total) - 1) >>> 0;
    this.low  = (this.low + Math.floor(range * cumLow  / total))     >>> 0;
    this._renormalize();
  }

  // --- internals ---

  _renormalize() {
    for (;;) {
      if (this.high < HALF) {
        // MSB = 0
        this.low   = (this.low  << 1) >>> 0;
        this.high  = ((this.high << 1) | 1) >>> 0;
        this.value = ((this.value << 1) | this.reader.readBit()) >>> 0;
      } else if (this.low >= HALF) {
        // MSB = 1
        this.low   = ((this.low   - HALF) << 1) >>> 0;
        this.high  = (((this.high  - HALF) << 1) | 1) >>> 0;
        this.value = (((this.value - HALF) << 1) | this.reader.readBit()) >>> 0;
      } else if (this.low >= QUARTER && this.high < 3 * QUARTER) {
        // Underflow
        this.low   = ((this.low   - QUARTER) << 1) >>> 0;
        this.high  = (((this.high  - QUARTER) << 1) | 1) >>> 0;
        this.value = (((this.value - QUARTER) << 1) | this.reader.readBit()) >>> 0;
      } else {
        break;
      }
    }
  }
}

module.exports = { ArithmeticEncoder, ArithmeticDecoder, NUM_BITS, WHOLE, HALF, QUARTER };
