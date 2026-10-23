/**
 * Payment link status watcher.
 *
 * Polls the Global Payments Links API via the MCP server to track settlement.
 * Crucial insight from Second Brain:
 * A paid link remains status: ACTIVE while transactions.transaction_list[0].status
 * transitions to CAPTURED. We must check the transaction list!
 */

export class PaymentWatcher {
  constructor({ mcpClient, onStatus = () => {}, onPaid = () => {}, intervalMs = 4000 }) {
    this.mcpClient = mcpClient;
    this.onStatus = onStatus;
    this.onPaid = onPaid;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.linkId = null;
    this.attempts = 0;
    this.maxAttempts = 75; // ~5 minutes
  }

  watch(linkId) {
    this.stop();
    this.linkId = linkId;
    this.attempts = 0;
    this.tick();
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async tick() {
    if (!this.linkId) return;
    this.attempts++;

    try {
      const res = await this.mcpClient.callTool('get_links', { id: this.linkId });
      let linkData = null;
      if (Array.isArray(res?.content)) {
        const text = res.content.map((c) => c.text || '').join('\n');
        try {
          linkData = JSON.parse(text);
        } catch {
          /* text format */
        }
      }

      if (linkData) {
        const txList = linkData.transactions?.transaction_list || [];
        const firstTx = txList[0] || {};
        const txStatus = firstTx.status;
        const linkStatus = linkData.status;

        this.onStatus(txStatus || linkStatus, linkData);

        if (txStatus === 'CAPTURED' || txStatus === 'SUCCESS' || linkStatus === 'PAID') {
          this.onPaid(linkData);
          this.stop();
          return;
        }
      }
    } catch {
      /* ignore intermittent polling glitches */
    }

    if (this.attempts < this.maxAttempts) {
      this.timer = setTimeout(() => this.tick(), this.intervalMs);
    }
  }
}
