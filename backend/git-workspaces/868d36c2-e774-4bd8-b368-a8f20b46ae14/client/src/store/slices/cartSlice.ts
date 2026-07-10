// =============================================
// Cart Slice — Redux Toolkit
// =============================================
// Cart is managed in Redux for instant UI updates
// (optimistic updates), then synced to backend.
// =============================================

import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface CartItem {
  id: string;
  productId: string;
  name: string;
  image: string;
  slug: string;
  price: number;
  compareAtPrice?: number;
  quantity: number;
  maxQuantity: number;
  variant?: {
    sku: string;
    color?: string;
    size?: string;
  };
  seller: string;
}

interface CartState {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  discount: number;
  shippingCost: number;
  tax: number;
  total: number;
  couponCode: string | null;
  isOpen: boolean; // cart drawer
}

const initialState: CartState = {
  items: [],
  itemCount: 0,
  subtotal: 0,
  discount: 0,
  shippingCost: 0,
  tax: 0,
  total: 0,
  couponCode: null,
  isOpen: false,
};

function recalculateTotals(state: CartState) {
  state.itemCount = state.items.reduce((sum, item) => sum + item.quantity, 0);
  state.subtotal = state.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  state.tax = Math.round(state.subtotal * 0.18); // 18% GST
  state.shippingCost = state.subtotal > 499 ? 0 : 49; // Free shipping over ₹499
  state.total = state.subtotal + state.tax + state.shippingCost - state.discount;
}

const cartSlice = createSlice({
  name: 'cart',
  initialState,
  reducers: {
    addItem: (state, action: PayloadAction<CartItem>) => {
      const existingIndex = state.items.findIndex(
        (item) =>
          item.productId === action.payload.productId &&
          item.variant?.sku === action.payload.variant?.sku
      );

      if (existingIndex >= 0) {
        const item = state.items[existingIndex];
        item.quantity = Math.min(item.quantity + action.payload.quantity, item.maxQuantity);
      } else {
        state.items.push(action.payload);
      }
      recalculateTotals(state);
    },

    removeItem: (state, action: PayloadAction<string>) => {
      state.items = state.items.filter((item) => item.id !== action.payload);
      recalculateTotals(state);
    },

    updateQuantity: (state, action: PayloadAction<{ id: string; quantity: number }>) => {
      const item = state.items.find((item) => item.id === action.payload.id);
      if (item) {
        item.quantity = Math.min(Math.max(1, action.payload.quantity), item.maxQuantity);
      }
      recalculateTotals(state);
    },

    setDiscount: (state, action: PayloadAction<{ code: string; amount: number }>) => {
      state.couponCode = action.payload.code;
      state.discount = action.payload.amount;
      recalculateTotals(state);
    },

    clearDiscount: (state) => {
      state.couponCode = null;
      state.discount = 0;
      recalculateTotals(state);
    },

    clearCart: (state) => {
      state.items = [];
      state.couponCode = null;
      state.discount = 0;
      recalculateTotals(state);
    },

    setCartItems: (state, action: PayloadAction<CartItem[]>) => {
      state.items = action.payload;
      recalculateTotals(state);
    },

    toggleCartDrawer: (state) => {
      state.isOpen = !state.isOpen;
    },

    setCartOpen: (state, action: PayloadAction<boolean>) => {
      state.isOpen = action.payload;
    },
  },
});

export const {
  addItem,
  removeItem,
  updateQuantity,
  setDiscount,
  clearDiscount,
  clearCart,
  setCartItems,
  toggleCartDrawer,
  setCartOpen,
} = cartSlice.actions;

export default cartSlice.reducer;
