export interface FeeSettings {
  fee_percent: number;
  gst_percent: number;
  commission_percent: number;
  app_fee_gst_percent: number;
}

export interface FeeBreakdown {
  base: number;
  app_fee: number;
  app_fee_gst: number;
  gateway_fee: number;
  total: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Gateway fee (plus its GST) is charged on the whole amount, so gross up the total.
export function computeFeeBreakdown(base: number, fees: FeeSettings): FeeBreakdown {
  const appFee = round2((base * fees.commission_percent) / 100);
  const appFeeGst = round2((appFee * fees.app_fee_gst_percent) / 100);
  const net = base + appFee + appFeeGst;
  const gatewayRate = (fees.fee_percent * (1 + fees.gst_percent / 100)) / 100;
  const exact = gatewayRate > 0 && gatewayRate < 1 ? round2(net / (1 - gatewayRate)) : round2(net);
  // Players pay a whole-rupee amount; the round-up goes to the app fee.
  const total = Math.ceil(exact - 0.001);
  const gatewayFee = round2(exact - net);
  return { base: round2(base), app_fee: round2(appFee + total - exact), app_fee_gst: appFeeGst, gateway_fee: gatewayFee, total };
}
