// =============================================
// Payment Types — ShopVerse
// =============================================

export enum PaymentMethod {
  STRIPE = 'stripe',
  RAZORPAY = 'razorpay',
  COD = 'cash_on_delivery',
}

export enum PaymentStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  PARTIALLY_REFUNDED = 'partially_refunded',
}

export interface IPayment {
  _id: string;
  order: string;
  user: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  currency: string;
  transactionId?: string;
  stripePaymentIntentId?: string;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  razorpaySignature?: string;
  refundAmount?: number;
  refundId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ICreateStripePaymentIntent {
  orderId: string;
  amount: number;
  currency?: string;
}

export interface ICreateRazorpayOrder {
  orderId: string;
  amount: number;
  currency?: string;
}

export interface IVerifyRazorpayPayment {
  razorpayPaymentId: string;
  razorpayOrderId: string;
  razorpaySignature: string;
}
