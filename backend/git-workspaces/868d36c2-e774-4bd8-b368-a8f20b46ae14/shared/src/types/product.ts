// =============================================
// Product Types — ShopVerse
// =============================================

export interface IProductImage {
  url: string;
  publicId: string;
  alt?: string;
  isPrimary: boolean;
}

export interface IProductVariant {
  sku: string;
  color?: string;
  size?: string;
  price: number;
  compareAtPrice?: number;
  stock: number;
  images?: IProductImage[];
}

export interface IProductSpecification {
  key: string;
  value: string;
}

export enum ProductStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  OUT_OF_STOCK = 'out_of_stock',
  ARCHIVED = 'archived',
}

export interface IProduct {
  _id: string;
  name: string;
  slug: string;
  description: string;
  shortDescription?: string;
  images: IProductImage[];
  category: string; // category ID
  subcategory?: string;
  brand?: string;
  seller: string; // seller user ID
  price: number;
  compareAtPrice?: number;
  costPrice?: number;
  currency: string;
  variants: IProductVariant[];
  specifications: IProductSpecification[];
  tags: string[];
  status: ProductStatus;
  isFeatured: boolean;
  rating: number;
  reviewCount: number;
  totalSold: number;
  weight?: number;
  dimensions?: {
    length: number;
    width: number;
    height: number;
    unit: 'cm' | 'in';
  };
  estimatedDeliveryDays: number;
  returnPolicy?: string;
  warranty?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IProductFilters {
  category?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  rating?: number;
  inStock?: boolean;
  discount?: number;
  sort?: 'price_asc' | 'price_desc' | 'newest' | 'rating' | 'popularity';
  page?: number;
  limit?: number;
  search?: string;
}

export interface ICategory {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  parent?: string | null;
  children?: ICategory[];
  productCount: number;
  isActive: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}
