// =============================================
// Order Types — ShopVerse
// =============================================

export enum OrderStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  PACKED = 'packed',
  SHIPPED = 'shipped',
  OUT_FOR_DELIVERY = 'out_for_delivery',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
  RETURNED = 'returned',
  REFUNDED = 'refunded',
}

export enum ReturnStatus {
  REQUESTED = 'requested',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PICKED_UP = 'picked_up',
  REFUND_INITIATED = 'refund_initiated',
  REFUND_COMPLETED = 'refund_completed',
}

export interface IOrderItem {
  _id: string;
  product: string;
  productName: string;
  productImage: string;
  variant?: {
    sku: string;
    color?: string;
    size?: string;
  };
  quantity: number;
  price: number;
  total: number;
  seller: string;
  status: OrderStatus;
}

export interface IOrderAddress {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface IOrderTimeline {
  status: OrderStatus;
  timestamp: string;
  message?: string;
}

export interface IOrder {
  _id: string;
  orderNumber: string;
  user: string;
  items: IOrderItem[];
  shippingAddress: IOrderAddress;
  billingAddress?: IOrderAddress;
  subtotal: number;
  shippingCost: number;
  tax: number;
  discount: number;
  couponCode?: string;
  total: number;
  status: OrderStatus;
  timeline: IOrderTimeline[];
  paymentMethod: string;
  paymentId?: string;
  isPaid: boolean;
  paidAt?: string;
  estimatedDelivery?: string;
  deliveredAt?: string;
  returnStatus?: ReturnStatus;
  returnReason?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
