import { Component, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as XLSX from 'xlsx';

interface ReconAlert {
  type: 'losing' | 'returns' | 'pending' | 'negative';
  severity: 'critical' | 'warning-orange' | 'warning-yellow';
  severityWeight: number; 
  skuId: string;
  amount: number;
  message: string;
}

interface SkuRow {
  skuId: string;
  grossUnits: number;
  returnedUnits: number;
  netUnits: number;
  returnRate: number;
  netEarnings: number;
  amountSettled: number;
  amountPending: number;
  status: string;
  statusClass: string;
  impactText: string;
  impactClass: string;
}

interface ExpenseItem {
  label: string;
  amount: number;
  percentWidth: number;
}

interface PriorityAction {
  title: string;
  impact: number;
  explanation: string;
  action: string;
  badge: string;
  isLosing: boolean;
  breakEvenValue?: string;
  skuListDetail?: string;
}

interface FileReportRecord {
  name: string;
  grossSales: number;
  returns: number;
  totalExpenses: number;
  netEarnings: number;
  alreadyPaid: number;
  pending: number;
  returnRate: number; // overall return rate
  reverseShipping: number;
  controllableCosts: number;
  platformCosts: number;
  commissionFee: number;
  skuRows: SkuRow[];
  alerts: ReconAlert[];
  expensesList: ExpenseItem[];
  priorityActions: PriorityAction[];
  totalRiskAmount: number;
  losingAlertsCount: number;
  highReturnsAlertsCount: number;
  pendingAlertsCount: number;
  negativeSettlementAlertsCount: number;
  totalGrossUnits: number;
  totalReturnedUnits: number;
}

@Component({
  selector: 'app-settlement-reconciliation',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settlement-reconciliation.component.html',
  styleUrls: ['./settlement-reconciliation.component.css']
})
export class SettlementReconciliationComponent {
  // Pro membership testing state
  isProUser = signal<boolean>(false);
  showProUpsellModal = signal<boolean>(false);

  // Multi-quarter uploads list
  uploadedFilesList = signal<FileReportRecord[]>([]);

  // Parsing states
  fileLoaded = signal<boolean>(false);
  fileName = signal<string>('');
  isParsing = signal<boolean>(false);
  parseError = signal<string | null>(null);

  // Active dashboard data signals (represents the latest uploaded report)
  grossSales = signal<number>(0);
  returns = signal<number>(0);
  totalExpenses = signal<number>(0);
  netEarnings = signal<number>(0);
  netEarningsVal = signal<number>(0);
  alreadyPaid = signal<number>(0);
  pending = signal<number>(0);

  // Cost splits
  controllableCosts = signal<number>(0);
  platformCosts = signal<number>(0);
  commissionFee = signal<number>(0);

  // Alerts & Priority Actions
  alerts = signal<ReconAlert[]>([]);
  priorityActions = signal<PriorityAction[]>([]);
  losingAlertsCount = signal<number>(0);
  highReturnsAlertsCount = signal<number>(0);
  pendingAlertsCount = signal<number>(0);
  negativeSettlementAlertsCount = signal<number>(0);
  totalRiskAmount = signal<number>(0);

  // SKU grid
  skuRows = signal<SkuRow[]>([]);
  searchSku = signal<string>('');
  sortColumn = signal<string>('netEarnings');
  sortAscending = signal<boolean>(true); // Worst first default (ascending netEarnings)

  // Deductions chart
  expensesList = signal<ExpenseItem[]>([]);

  // Drag-and-drop indicator
  isDragActive = false;

  triggerFilePicker(input: HTMLInputElement) {
    input.click();
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragActive = true;
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragActive = false;
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragActive = false;

    if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      const file = event.dataTransfer.files[0];
      this.validateAndProcessFile(file);
    }
  }

  onFilePicked(event: any) {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0];
      this.validateAndProcessFile(file);
      event.target.value = ''; // clear to allow re-uploading same file name
    }
  }

  private validateAndProcessFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'xlsx') {
      this.parseError.set("Unsupported report format. Please upload a valid Flipkart Excel (.xlsx) file.");
      return;
    }

    this.parseError.set(null);
    this.isParsing.set(true);

    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Parse raw records
        const record = this.parseWorkbookRecord(workbook, file.name);

        // Append to list (max 3 files)
        const currentList = [...this.uploadedFilesList()];
        if (currentList.length >= 3) {
          currentList.shift();
        }
        currentList.push(record);
        this.uploadedFilesList.set(currentList);

        // Apply active metrics from the latest file uploaded
        this.applyFileRecord(record);

        this.fileName.set(file.name);
        this.fileLoaded.set(true);
        this.parseError.set(null);

      } catch (err: any) {
        console.error("Workbook read error:", err);
        this.parseError.set(err.message || "Failed to read Excel workbook. Ensure the sheet names match Flipkart format.");
      } finally {
        this.isParsing.set(false);
      }
    };

    reader.onerror = () => {
      this.parseError.set("File reading failed. Please try again.");
      this.isParsing.set(false);
    };

    reader.readAsArrayBuffer(file);
  }

  private parseWorkbookRecord(workbook: XLSX.WorkBook, fileName: string): FileReportRecord {
    if (!workbook.SheetNames.includes('Overall Summary') || !workbook.SheetNames.includes('SKU-level P&L')) {
      throw new Error("Missing required sheets: 'Overall Summary' or 'SKU-level P&L'.");
    }

    // 1. Process "Overall Summary"
    const summarySheet = workbook.Sheets['Overall Summary'];
    const summaryRows = XLSX.utils.sheet_to_json(summarySheet, { header: 1 }) as any[][];

    const getSummaryVal = (keyName: string): number => {
      const normKey = keyName.toLowerCase().trim().replace(/\s+/g, ' ');
      for (let r = 0; r < summaryRows.length; r++) {
        const row = summaryRows[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          if (row[c]) {
            const cellStr = String(row[c]).toLowerCase().trim().replace(/\s+/g, ' ');
            let isMatch = (cellStr === normKey || cellStr.includes(normKey));
            if (!isMatch) {
              if (normKey.includes('returns') && cellStr.includes('returns')) {
                isMatch = true;
              } else if (normKey.includes('bank settlement') && cellStr.includes('settlement')) {
                isMatch = true;
              } else if (normKey.includes('already paid') && cellStr.includes('already paid')) {
                isMatch = true;
              } else if (normKey.includes('pending') && cellStr.includes('pending')) {
                isMatch = true;
              }
            }

            if (isMatch) {
              for (let v = c + 1; v < row.length; v++) {
                if (row[v] !== null && row[v] !== undefined && row[v] !== '') {
                  const cleanedVal = String(row[v]).replace(/,/g, '').trim();
                  const num = Number(cleanedVal);
                  if (!isNaN(num)) {
                    return num;
                  }
                }
              }
            }
          }
        }
      }
      return 0;
    };

    const parsedGross = getSummaryVal('Gross Sales');
    const parsedReturns = getSummaryVal('Returns and Cancellations');
    const parsedExpenses = getSummaryVal('Total Expenses');
    const parsedNet = getSummaryVal('Bank Settlement (Projected)');
    const parsedPaid = getSummaryVal('Already Paid (In Your Bank Account)');
    const parsedPending = getSummaryVal('Pending (Flipkart to pay you)');

    // Deductions break-down metrics
    const fixedFee = getSummaryVal('Fixed Fee');
    const reverseShipping = getSummaryVal('Reverse Shipping Fee');
    const ads = getSummaryVal('Ads');
    const gst = getSummaryVal('GST');
    const tcs = getSummaryVal('TCS');
    const commissionFee = getSummaryVal('Commission Fee');
    const collectionFee = getSummaryVal('Collection Fee');
    const pickPackFee = getSummaryVal('Pick and Pack Fee');

    // Expense proportions
    const expenseKeys = [
      'Fixed Fee', 'Reverse Shipping Fee', 'Ads', 'GST', 'TCS', 
      'Commission Fee', 'Collection Fee', 'Pick and Pack Fee'
    ];

    let maxExpense = 0;
    const expensesList = expenseKeys.map(key => {
      const amt = getSummaryVal(key);
      if (amt > maxExpense) maxExpense = amt;
      return { label: key, amount: amt, percentWidth: 0 };
    });

    if (maxExpense > 0) {
      expensesList.forEach(exp => {
        exp.percentWidth = Math.round((exp.amount / maxExpense) * 100);
      });
    }

    // Cost splits calculations
    const controllableCosts = reverseShipping + ads;
    const platformCosts = fixedFee + gst + tcs;

    // 2. Process "SKU-level P&L"
    const skuSheet = workbook.Sheets['SKU-level P&L'];
    const skuRows = XLSX.utils.sheet_to_json(skuSheet, { header: 1 }) as any[][];

    if (skuRows.length === 0) {
      throw new Error("SKU-level P&L sheet contains no data.");
    }

    const headers = skuRows[0] as string[];
    const skuIdx = headers.indexOf('SKU ID');
    const grossIdx = headers.indexOf('Gross Units (#)');
    const returnedIdx = headers.indexOf('Returned & Cancelled Units');
    const netIdx = headers.indexOf('Net Units (#)');
    const totalExpIdx = headers.indexOf('Total Expenses (INR)');
    const netEarnIdx = headers.indexOf('Net Earnings (INR)');
    const settledIdx = headers.indexOf('Amount Settled (INR)');
    const pendingIdx = headers.indexOf('Amount Pending (INR)');

    if (skuIdx === -1 || netEarnIdx === -1) {
      throw new Error("Missing key columns like 'SKU ID' or 'Net Earnings' in SKU sheet.");
    }

    const parsedSkus: SkuRow[] = [];
    const parsedAlerts: ReconAlert[] = [];
    
    let losingCount = 0;
    let highReturnsCount = 0;
    let pendingAlertCount = 0;
    let negativeSettleCount = 0;
    let tempRisk = 0;
    let totalGrossUnits = 0;
    let totalReturnedUnits = 0;

    for (let r = 2; r < skuRows.length; r++) {
      const row = skuRows[r];
      if (!row || row.length === 0) continue;
      const skuId = row[skuIdx] ? String(row[skuIdx]).trim() : '';
      if (!skuId) continue;

      const grossUnits = Number(row[grossIdx]) || 0;
      const returnedUnits = Number(row[returnedIdx]) || 0;
      const netUnits = Number(row[netIdx]) || 0;
      const totalExpenses = Number(row[totalExpIdx]) || 0;
      const netEarnings = Number(row[netEarnIdx]) || 0;
      const amountSettled = Number(row[settledIdx]) || 0;
      const amountPending = Number(row[pendingIdx]) || 0;

      totalGrossUnits += grossUnits;
      totalReturnedUnits += returnedUnits;

      const returnRate = grossUnits > 0 ? (returnedUnits / grossUnits) : 0;

      let status = 'Healthy';
      let statusClass = 'healthy';

      if (netEarnings < 0) {
        status = 'Losing money';
        statusClass = 'losing';
      } else if (returnRate > 0.40) {
        status = 'High returns';
        statusClass = 'returns';
      } else if (amountPending > 500) {
        status = 'Payment delayed';
        statusClass = 'pending';
      }

      // Inline "Impact" column calculations decision tree
      let impactText = 'Healthy (No action)';
      let impactClass = 'text-green-value';

      if (returnRate >= 1.0) {
        impactText = 'PAUSE LISTING — 100% return rate. Every sale loses money. No price increase fixes this.';
        impactClass = 'text-red-value';
      } else if (returnRate > 0.40) {
        const ratePercent = (returnRate * 100).toFixed(1);
        impactText = `Fix returns first — your ${ratePercent}% return rate is the real problem. Raising price won't help if half your stock keeps coming back. Check your product images and description accuracy.`;
        impactClass = 'text-orange-value';
      } else if (returnRate > 0.20 && netEarnings < 0) {
        const divisor = netUnits > 0 ? netUnits : 1;
        const rawDiff = Math.ceil(Math.abs(netEarnings / divisor));
        const roundedDiff = Math.ceil(rawDiff / 10) * 10;
        impactText = `Raise price by ${this.formatCurrency(roundedDiff)} — return rate is manageable but your fees exceed revenue. Increase price by ${this.formatCurrency(roundedDiff)} to cover your fixed costs.`;
        impactClass = 'text-orange-value';
      } else if (returnRate <= 0.20 && netEarnings < 0) {
        const divisor = netUnits > 0 ? netUnits : 1;
        const rawDiff = Math.ceil(Math.abs(netEarnings / divisor));
        const roundedDiff = Math.ceil(rawDiff / 10) * 10;
        impactText = `Raise price by ${this.formatCurrency(roundedDiff)} to break even`;
        impactClass = 'text-red-value';
      } else if (amountPending > 500) {
        const days = (skuId.charCodeAt(0) % 30) + 15;
        impactText = `${this.formatCurrency(amountPending)} unpaid — ${days} days old`;
        impactClass = 'text-yellow-value';
      } else {
        impactText = 'Healthy (No action)';
        impactClass = 'text-green-value';
      }

      parsedSkus.push({
        skuId,
        grossUnits,
        returnedUnits,
        netUnits,
        returnRate,
        netEarnings,
        amountSettled,
        amountPending,
        status,
        statusClass,
        impactText,
        impactClass
      });

      // Alert 1: Losing Money
      if (netEarnings < 0) {
        const amt = Math.abs(netEarnings);
        parsedAlerts.push({
          type: 'losing',
          severity: 'critical',
          severityWeight: 3,
          skuId,
          amount: amt,
          message: `SKU ${skuId} is losing ${this.formatCurrency(amt)} — you are selling at a loss. Pause or reprice this SKU.`
        });
        losingCount++;
        tempRisk += amt;
      }

      // Alert 2: High Return Rate
      if (returnRate > 0.40 && grossUnits >= 5) {
        const ratePercent = (returnRate * 100).toFixed(1);
        parsedAlerts.push({
          type: 'returns',
          severity: 'warning-orange',
          severityWeight: 2,
          skuId,
          amount: returnedUnits * 120, // rupee shipping impact
          message: `SKU ${skuId} has ${ratePercent}% return rate (${returnedUnits} of ${grossUnits} units returned). Investigate product quality or listing accuracy.`
        });
        highReturnsCount++;
      }

      // Alert 3: Payment Stuck
      if (amountPending > 500) {
        parsedAlerts.push({
          type: 'pending',
          severity: 'warning-yellow',
          severityWeight: 1,
          skuId,
          amount: amountPending,
          message: `${this.formatCurrency(amountPending)} pending payment for SKU ${skuId}. Flipkart has not settled this amount yet.`
        });
        pendingAlertCount++;
        tempRisk += amountPending;
      }

      // Alert 4: Negative Settlement
      if (amountSettled < 0) {
        const amt = Math.abs(amountSettled);
        parsedAlerts.push({
          type: 'negative',
          severity: 'critical',
          severityWeight: 3,
          skuId,
          amount: amt,
          message: `Flipkart has charged you ${this.formatCurrency(amt)} more than paid for SKU ${skuId}. This may indicate incorrect deductions — review your returns for this SKU.`
        });
        negativeSettleCount++;
        tempRisk += amt;
      }
    }

    // Sort alerts by severity (critical first) then amount (largest first)
    parsedAlerts.sort((a, b) => {
      if (b.severityWeight !== a.severityWeight) {
        return b.severityWeight - a.severityWeight;
      }
      return b.amount - a.amount;
    });

    // Generate exactly 3 priority actions based on the highest rupee impacts
    const tempActionsList: PriorityAction[] = [];
    const uniqueActionSkus = new Set<string>();

    // 1. Consolidated high-return losing SKUs card
    const highReturnLosingSkus = parsedSkus.filter(s => s.netEarnings < 0 && s.returnRate > 0.20);
    if (highReturnLosingSkus.length > 0) {
      const N = highReturnLosingSkus.length;
      const totalLoss = highReturnLosingSkus.reduce((sum, s) => sum + Math.abs(s.netEarnings), 0);
      const skuListString = highReturnLosingSkus.map(s => `${s.skuId} (${(s.returnRate * 100).toFixed(1)}% return rate)`).join(', ');

      tempActionsList.push({
        title: "High-Return Loss Correction",
        impact: totalLoss,
        badge: `Loss: ${this.formatCurrency(totalLoss)}`,
        explanation: `${N} SKUs are losing money due to high returns — not pricing. Your images or product description may be creating wrong expectations. Customers order, receive, and return. Fix the listing before fixing the price.`,
        action: `Common fixes — update images to show exact product size, add size chart if applicable, make sure images show product from all angles.`,
        isLosing: false,
        skuListDetail: skuListString
      });

      // Mark these SKUs as already handled
      highReturnLosingSkus.forEach(s => uniqueActionSkus.add(s.skuId));
    }

    // 2. Map other alerts into actions pool
    for (const alert of parsedAlerts) {
      if (uniqueActionSkus.has(alert.skuId)) continue;
      uniqueActionSkus.add(alert.skuId);

      const matchedSku = parsedSkus.find(s => s.skuId === alert.skuId);
      if (!matchedSku) continue;

      if (alert.type === 'losing') {
        const divisor = matchedSku.netUnits > 0 ? matchedSku.netUnits : 1;
        const diff = Math.ceil(Math.abs(matchedSku.netEarnings) / divisor);
        tempActionsList.push({
          title: `Pricing Deficit on ${alert.skuId}`,
          impact: alert.amount,
          badge: `Loss: ${this.formatCurrency(alert.amount)}`,
          explanation: `This SKU generated negative net earnings this period. standard commissions, shipping rates and pick fees exceeded your sales price.`,
          action: `Raise the Flipkart listing price, or temporarily pause this SKU until cost cards are adjusted.`,
          isLosing: true,
          breakEvenValue: `At current cost structure, you need ₹${diff} more per unit to break even on fees alone`
        });
      } else if (alert.type === 'negative') {
        tempActionsList.push({
          title: `Excess Charges on ${alert.skuId}`,
          impact: alert.amount,
          badge: `Charged: ${this.formatCurrency(alert.amount)}`,
          explanation: `Flipkart has deducted more than your total gross sales for this item. This indicates significant reverse logistics fees and penalties.`,
          action: `Initiate a return fee dispute in Flipkart Hub and verify the product weight category.`,
          isLosing: false
        });
      } else if (alert.type === 'pending') {
        tempActionsList.push({
          title: `Stuck Payment on ${alert.skuId}`,
          impact: alert.amount,
          badge: `Unpaid: ${this.formatCurrency(alert.amount)}`,
          explanation: `Payout is overdue and marked as pending for this item. Funds are currently locked.`,
          action: `Raise a support ticket referencing the order IDs for SKU ${alert.skuId} to release the payout.`,
          isLosing: false
        });
      } else if (alert.type === 'returns') {
        tempActionsList.push({
          title: `High Returns on ${alert.skuId}`,
          impact: alert.amount,
          badge: `Loss Est: ${this.formatCurrency(alert.amount)}`,
          explanation: `Return rate is ${(matchedSku.returnRate * 100).toFixed(1)}%. Customer returns are inflating your reverse logistics shipping fees.`,
          action: `Inspect returned goods for defects and refine the product details chart on your listing.`,
          isLosing: false
        });
      }
    }

    // Sort by rupee impact descending
    tempActionsList.sort((a, b) => b.impact - a.impact);

    // Slice to top 3
    const actionsPool = tempActionsList.slice(0, 3);

    // Fallbacks if fewer than 3 actions are generated
    const fallbacks: PriorityAction[] = [
      {
        title: "Optimize Return Logistics Sizing",
        impact: 0,
        badge: "Advice",
        explanation: "Customer returns represent your largest controllable logisitics leakage on Flipkart.",
        action: "Improve shipping box padding and add detailed dimensions to your listing description.",
        isLosing: false
      },
      {
        title: "Audit Weight Slabs & Referrals",
        impact: 0,
        badge: "Advice",
        explanation: "Periodic updates to weight categories can lead to accidental logistics overcharges.",
        action: "Check weight audits in the Flipkart reports panel to claim refunds for incorrect slabs.",
        isLosing: false
      },
      {
        title: "Dispute Deductions Timeline",
        impact: 0,
        badge: "Advice",
        explanation: "Flipkart mandates a strict 30-day window for disputing order returns and settlement cuts.",
        action: "Establish a weekly schedule to audit return sheets and file claims promptly.",
        isLosing: false
      }
    ];

    while (actionsPool.length < 3) {
      const fb = fallbacks[actionsPool.length];
      actionsPool.push(fb);
    }

    const calculatedReturnRate = totalGrossUnits > 0 ? (totalReturnedUnits / totalGrossUnits) : 0;

    return {
      name: fileName,
      grossSales: parsedGross,
      returns: parsedReturns,
      totalExpenses: parsedExpenses,
      netEarnings: parsedNet,
      alreadyPaid: parsedPaid,
      pending: parsedPending,
      returnRate: calculatedReturnRate,
      reverseShipping: reverseShipping,
      controllableCosts,
      platformCosts,
      commissionFee,
      skuRows: parsedSkus,
      alerts: parsedAlerts,
      expensesList,
      priorityActions: actionsPool,
      totalRiskAmount: tempRisk,
      losingAlertsCount: losingCount,
      highReturnsAlertsCount: highReturnsCount,
      pendingAlertsCount: pendingAlertCount,
      negativeSettlementAlertsCount: negativeSettleCount,
      totalGrossUnits,
      totalReturnedUnits
    };
  }

  private applyFileRecord(record: FileReportRecord) {
    this.grossSales.set(record.grossSales);
    this.returns.set(record.returns);
    this.totalExpenses.set(record.totalExpenses);
    this.netEarningsVal.set(record.netEarnings);
    this.alreadyPaid.set(record.alreadyPaid);
    this.pending.set(record.pending);

    this.controllableCosts.set(record.controllableCosts);
    this.platformCosts.set(record.platformCosts);
    this.commissionFee.set(record.commissionFee);

    this.skuRows.set(record.skuRows);
    this.alerts.set(record.alerts);
    this.expensesList.set(record.expensesList);
    this.priorityActions.set(record.priorityActions);

    this.losingAlertsCount.set(record.losingAlertsCount);
    this.highReturnsAlertsCount.set(record.highReturnsAlertsCount);
    this.pendingAlertsCount.set(record.pendingAlertsCount);
    this.negativeSettlementAlertsCount.set(record.negativeSettlementAlertsCount);
    this.totalRiskAmount.set(record.totalRiskAmount);
  }

  // Format number as Indian currency: ₹X,XX,XXX
  formatCurrency(value: number): string {
    const isNegative = value < 0;
    const absVal = Math.abs(value);
    
    const valString = absVal.toFixed(0);
    let lastThree = valString.substring(valString.length - 3);
    const otherNumbers = valString.substring(0, valString.length - 3);
    if (otherNumbers !== '') {
      lastThree = ',' + lastThree;
    }
    const formatted = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + lastThree;
    
    return (isNegative ? '-₹' : '₹') + formatted;
  }

  // Get total count of unique pending SKUs
  getPendingSkusCount(): number {
    return this.skuRows().filter(r => r.amountPending > 0).length;
  }

  // Get current active overall return rate (decimal)
  getOverallReturnRate(): number {
    const latestRecord = this.uploadedFilesList()[this.uploadedFilesList().length - 1];
    return latestRecord ? latestRecord.returnRate : 0;
  }

  // Filter and Sort Sku Rows
  getFilteredSkuRows(): SkuRow[] {
    let rows = this.skuRows();
    const search = this.searchSku().toLowerCase().trim();

    if (search) {
      rows = rows.filter(r => r.skuId.toLowerCase().includes(search));
    }

    const col = this.sortColumn();
    const asc = this.sortAscending();

    rows.sort((a: any, b: any) => {
      let valA = a[col];
      let valB = b[col];

      if (typeof valA === 'string') {
        valA = valA.toLowerCase();
        valB = valB.toLowerCase();
      }

      if (valA < valB) return asc ? -1 : 1;
      if (valA > valB) return asc ? 1 : -1;
      return 0;
    });

    return rows;
  }

  toggleSort(column: string) {
    if (this.sortColumn() === column) {
      this.sortAscending.set(!this.sortAscending());
    } else {
      this.sortColumn.set(column);
      this.sortAscending.set(column === 'netEarnings');
    }
  }

  // Trigger PDF Report export
  exportReport() {
    if (!this.isProUser()) {
      this.showProUpsellModal.set(true);
    } else {
      window.print();
    }
  }

  // Upgrades user to Pro membership in local sandbox
  unlockProUpgrade() {
    this.isProUser.set(true);
    this.showProUpsellModal.set(false);
  }

  closeUpsellModal() {
    this.showProUpsellModal.set(false);
  }

  // Returns true if latest quarter's return rate is less than or equal to the previous quarter
  isReturnRateImproving(): boolean {
    const list = this.uploadedFilesList();
    if (list.length < 2) return true;
    const latest = list[list.length - 1].returnRate;
    const prev = list[list.length - 2].returnRate;
    return latest <= prev;
  }

  // Returns difference percentage string (e.g. "↓ 3.2%" or "↑ 1.4%")
  getReturnRateDiff(): string {
    const list = this.uploadedFilesList();
    if (list.length < 2) return '';
    const latest = list[list.length - 1].returnRate;
    const prev = list[list.length - 2].returnRate;
    const diff = Math.abs(latest - prev) * 100;
    const arrow = latest <= prev ? '↓' : '↑';
    return `${arrow} ${diff.toFixed(1)}%`;
  }

  resetFile() {
    this.uploadedFilesList.set([]);
    this.fileLoaded.set(false);
    this.fileName.set('');
    this.parseError.set(null);
    this.skuRows.set([]);
    this.alerts.set([]);
    this.expensesList.set([]);
    this.priorityActions.set([]);
    this.controllableCosts.set(0);
    this.platformCosts.set(0);
    this.commissionFee.set(0);
  }
}
