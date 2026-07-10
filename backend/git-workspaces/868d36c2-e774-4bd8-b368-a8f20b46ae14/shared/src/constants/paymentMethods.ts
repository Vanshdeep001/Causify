// =============================================
// Shared Constants — Payment Methods
// =============================================

export const PAYMENT_METHODS = {
  STRIPE: 'stripe',
  RAZORPAY: 'razorpay',
  COD: 'cash_on_delivery',
} as const;

export type PaymentMethodType = (typeof PAYMENT_METHODS)[keyof typeof PAYMENT_METHODS];

export const PAYMENT_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded',
} as const;

export type PaymentStatusType = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodType, string> = {
  [PAYMENT_METHODS.STRIPE]: 'Credit / Debit Card',
  [PAYMENT_METHODS.RAZORPAY]: 'Razorpay (UPI, Netbanking, Wallet)',
  [PAYMENT_METHODS.COD]: 'Cash on Delivery',
};

export const SUPPORTED_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];
export const DEFAULT_CURRENCY: Currency = 'INR';
