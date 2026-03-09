#!/usr/bin/env python3
"""
Gera gráficos de análise do compressor PPM-C:
1. Comparação Reset vs Sem Reset (comprimento médio progressivo)
2. Variação do K (ordem do modelo)
"""

import csv
import sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

# =============================================================================
# Gráfico 1: Reset vs Sem Reset (Passo 4/5)
# =============================================================================

def ler_csv_metricas(filepath):
    """Lê CSV de métricas, ignorando linhas de comentário (# RESET ...)"""
    posicoes = []
    comprimentos = []
    resets = []
    with open(filepath, 'r') as f:
        reader = csv.reader(f)
        for row in reader:
            if not row:
                continue
            line = row[0].strip()
            if line.startswith('#'):
                # Extrair posição do reset
                if 'RESET' in line:
                    parts = line.split()
                    for i, p in enumerate(parts):
                        if p == 'symbol':
                            resets.append(int(parts[i + 1]))
                continue
            if line == 'n_simbolos_processados':
                continue  # header
            try:
                posicoes.append(int(row[0]))
                comprimentos.append(float(row[1]))
            except (ValueError, IndexError):
                continue
    return posicoes, comprimentos, resets


def calcular_taxa_local(posicoes, comprimentos, janela=500):
    """Calcula taxa local (derivada do comprimento médio) usando janela deslizante."""
    taxa_local = []
    pos_local = []
    for i in range(janela, len(posicoes)):
        # bits acumulados = comprimento_medio * posição
        bits_atual = comprimentos[i] * posicoes[i]
        bits_anterior = comprimentos[i - janela] * posicoes[i - janela]
        delta_bits = bits_atual - bits_anterior
        delta_pos = posicoes[i] - posicoes[i - janela]
        if delta_pos > 0:
            taxa_local.append(delta_bits / delta_pos)
            pos_local.append(posicoes[i])
    return pos_local, taxa_local


def grafico_reset_vs_sem_reset():
    pos_sem, comp_sem, _ = ler_csv_metricas('../results/csv_sem_reset.csv')
    pos_com, comp_com, resets = ler_csv_metricas('../results/csv_com_reset.csv')

    # Calcular taxa local (mostra melhor o efeito da transição)
    pos_local_sem, taxa_local_sem = calcular_taxa_local(pos_sem, comp_sem, janela=200)
    pos_local_com, taxa_local_com = calcular_taxa_local(pos_com, comp_com, janela=200)

    fig, axes = plt.subplots(2, 1, figsize=(14, 10), gridspec_kw={'height_ratios': [1, 1]})

    # Subplot 1: Comprimento Médio Progressivo (acumulado)
    ax1 = axes[0]
    ax1.plot(pos_sem, comp_sem, label='Sem Reset', color='#e74c3c', alpha=0.8, linewidth=0.8)
    ax1.plot(pos_com, comp_com, label='Com Reset (janela=1000, limiar=15%)', color='#2ecc71', alpha=0.8, linewidth=0.8)
    ax1.axvline(x=5242880, color='#8e44ad', alpha=0.7, linestyle='-', linewidth=2, label='Transicao texto→binario')
    ax1.set_xlabel('Bytes Processados (n)', fontsize=11)
    ax1.set_ylabel('Comprimento Medio Progressivo\n(bits/byte)', fontsize=11)
    ax1.set_title('Media Acumulada (suavizada)', fontsize=12)
    ax1.legend(fontsize=10)
    ax1.grid(True, alpha=0.3)

    # Subplot 2: Taxa Local (janela deslizante) - mostra o efeito real
    ax2 = axes[1]
    ax2.plot(pos_local_sem, taxa_local_sem, label='Sem Reset', color='#e74c3c', alpha=0.7, linewidth=0.6)
    ax2.plot(pos_local_com, taxa_local_com, label='Com Reset (janela=1000, limiar=15%)', color='#2ecc71', alpha=0.7, linewidth=0.6)
    ax2.axvline(x=5242880, color='#8e44ad', alpha=0.7, linestyle='-', linewidth=2, label='Transicao texto→binario')

    # Marcar resets apenas no gráfico local
    for r in resets:
        ax2.axvline(x=r, color='#3498db', alpha=0.15, linestyle='--', linewidth=0.3)
    if resets:
        ax2.axvline(x=resets[0], color='#3498db', alpha=0.15, linestyle='--',
                     linewidth=0.3, label='Reset disparado')

    ax2.set_xlabel('Bytes Processados (n)', fontsize=11)
    ax2.set_ylabel('Taxa Local de Compressao\n(bits/byte, janela 20K)', fontsize=11)
    ax2.set_title('Taxa Instantanea (revela impacto da transicao)', fontsize=12)
    ax2.legend(fontsize=10)
    ax2.grid(True, alpha=0.3)
    ax2.set_ylim(0, 10)

    plt.suptitle('PPM-C: Efeito do Reset Dinamico em Dados Nao-Estacionarios\n(5MB texto Dickens + 5MB binario Mozilla)', fontsize=13)
    plt.tight_layout()
    plt.savefig('../results/grafico_reset_vs_sem_reset.png', dpi=150)
    print('Salvo: ../results/grafico_reset_vs_sem_reset.png')


# =============================================================================
# Gráfico 2: Variação do K (Passo 3)
# =============================================================================

def grafico_variacao_k():
    # Dados coletados dos testes (dickens, 10,192,446 bytes)
    original_size = 10192446
    dados_k = [
        (0, 5774713, 160.64),
        (1, 4466513, 109.73),
        (2, 3581537, 94.83),
        (3, 2892776, 89.85),
        (4, 2549877, 96.44),
        (5, 2432507, 107.10),
    ]

    ks = [d[0] for d in dados_k]
    bits_por_byte = [(d[1] * 8) / original_size for d in dados_k]
    tempos = [d[2] for d in dados_k]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))

    # Subplot 1: Comprimento médio vs K
    ax1.bar(ks, bits_por_byte, color='#3498db', alpha=0.8, edgecolor='#2c3e50')
    ax1.plot(ks, bits_por_byte, 'o-', color='#e74c3c', linewidth=2, markersize=8)
    ax1.set_xlabel('Ordem Maxima (K)', fontsize=12)
    ax1.set_ylabel('Comprimento Medio (bits/byte)', fontsize=12)
    ax1.set_title('Compressao vs Ordem do Modelo', fontsize=13)
    ax1.set_xticks(ks)
    ax1.grid(True, alpha=0.3, axis='y')

    for i, (k, bpb) in enumerate(zip(ks, bits_por_byte)):
        ax1.annotate(f'{bpb:.2f}', (k, bpb), textcoords="offset points",
                     xytext=(0, 10), ha='center', fontsize=9)

    # Subplot 2: Tempo de execução vs K
    ax2.bar(ks, tempos, color='#e67e22', alpha=0.8, edgecolor='#2c3e50')
    ax2.plot(ks, tempos, 'o-', color='#e74c3c', linewidth=2, markersize=8)
    ax2.set_xlabel('Ordem Maxima (K)', fontsize=12)
    ax2.set_ylabel('Tempo de Execucao (s)', fontsize=12)
    ax2.set_title('Tempo de Execucao vs Ordem do Modelo', fontsize=13)
    ax2.set_xticks(ks)
    ax2.grid(True, alpha=0.3, axis='y')

    for i, (k, t) in enumerate(zip(ks, tempos)):
        ax2.annotate(f'{t:.1f}s', (k, t), textcoords="offset points",
                     xytext=(0, 10), ha='center', fontsize=9)

    plt.suptitle('Arquivo: dickens (Silesia Corpus) - 10,192,446 bytes', fontsize=11, y=0.02)
    plt.tight_layout()
    plt.savefig('../results/grafico_variacao_k.png', dpi=150)
    print('Salvo: ../results/grafico_variacao_k.png')


# =============================================================================
# Main
# =============================================================================

if __name__ == '__main__':
    print('Gerando grafico de variacao do K...')
    grafico_variacao_k()

    try:
        print('Gerando grafico de Reset vs Sem Reset...')
        grafico_reset_vs_sem_reset()
    except FileNotFoundError as e:
        print(f'CSV ainda nao disponivel: {e}')
        print('Execute novamente apos a compressao terminar.')
