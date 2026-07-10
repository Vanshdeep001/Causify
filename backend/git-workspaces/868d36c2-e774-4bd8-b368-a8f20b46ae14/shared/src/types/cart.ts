// =============================================
// Cart Types — ShopVerse
// =============================================

export interface ICartItem {
  _id: string;
  product: string;
  productName: string;
  productImage: string;
  productSlug: string;
  variant?: {
    sku: string;
    color?: string;
    size?: string;
  };
  price: number;
  compareAtPrice?: number;
  quantity: number;
  maxQuantity: number;
  total: number;
  seller: string;
}

export interface ICart {
  _id: string;
  user: string;
  items: ICartItem[];
  subtotal: number;
  itemCount: number;
  couponCode?: string;
  discount: number;
  shippingCost: number;
  tax: number;
  total: number;
  updatedAt: string;
}

export interface IAddToCartPayload {
  productId: string;
  quantity: number;
  variantSku?: string;
}

export interface IUpdateCartItemPayload {
  quantity: number;
}
