"use strict";

const fs = require("fs");

// ---------------------------------------------------------------------------
// BitWriter — escreve bits individuais em um buffer, descarrega em arquivo.
// ---------------------------------------------------------------------------
class BitWriter {
  constructor(filePath) {
    this.fd = fs.openSync(filePath, "w");
    this.buffer = 0;       // byte sendo montado
    this.bitsInBuffer = 0; // quantos bits já foram escritos no byte atual
    this.totalBits = 0;    // contagem global de bits emitidos
  }

  /** Escreve um único bit (0 ou 1). */
  writeBit(bit) {
    this.buffer = (this.buffer << 1) | (bit & 1);
    this.bitsInBuffer++;
    this.totalBits++;
    if (this.bitsInBuffer === 8) {
      this._flushByte();
    }
  }

  /** Escreve `count` bits do valor `value` (MSB primeiro). */
  writeBits(value, count) {
    for (let i = count - 1; i >= 0; i--) {
      this.writeBit((value >>> i) & 1);
    }
  }

  /** Descarrega o byte parcial (preenchendo com zeros à direita) e fecha. */
  flush() {
    if (this.bitsInBuffer > 0) {
      this.buffer <<= (8 - this.bitsInBuffer);
      this._flushByte();
    }
    fs.closeSync(this.fd);
    this.fd = null;
  }

  _flushByte() {
    const buf = Buffer.alloc(1);
    buf[0] = this.buffer & 0xFF;
    fs.writeSync(this.fd, buf);
    this.buffer = 0;
    this.bitsInBuffer = 0;
  }
}

// ---------------------------------------------------------------------------
// BitReader — lê bits individuais de um arquivo.
// ---------------------------------------------------------------------------
class BitReader {
  constructor(filePath) {
    this.data = fs.readFileSync(filePath);
    this.bytePos = 0;      // índice do byte atual
    this.bitPos = 0;        // próximo bit a ler dentro do byte (7 = MSB)
    this.currentByte = 0;
    this.eof = false;
    this._loadByte();
  }

  /** Lê um único bit. Retorna 0 ou 1 (ou -1 se EOF). */
  readBit() {
    if (this.eof) return 0; // após EOF, retorna 0 (padding)
    const bit = (this.currentByte >>> (7 - this.bitPos)) & 1;
    this.bitPos++;
    if (this.bitPos === 8) {
      this.bitPos = 0;
      this.bytePos++;
      this._loadByte();
    }
    return bit;
  }

  /** Lê `count` bits e retorna como inteiro (MSB primeiro). */
  readBits(count) {
    let value = 0;
    for (let i = 0; i < count; i++) {
      value = (value << 1) | this.readBit();
    }
    return value;
  }

  _loadByte() {
    if (this.bytePos < this.data.length) {
      this.currentByte = this.data[this.bytePos];
    } else {
      this.eof = true;
      this.currentByte = 0;
    }
  }
}

module.exports = { BitWriter, BitReader };
