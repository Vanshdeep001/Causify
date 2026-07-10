// =============================================
// Site Configuration — ShopVerse
// =============================================

export const siteConfig = {
  name: 'ShopVerse',
  description: 'Discover premium products from top brands. Shop fashion, electronics, home & more with exclusive deals and fast delivery.',
  url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  ogImage: '/images/og-image.jpg',
  keywords: [
    'ecommerce',
    'online shopping',
    'fashion',
    'electronics',
    'deals',
    'ShopVerse',
    'multi-vendor marketplace',
  ],
  creator: 'ShopVerse Team',
  themeColor: '#C41E3A',
};

export const navLinks = [
  { label: 'Home', href: '/' },
  { label: 'Products', href: '/products' },
  { label: 'Categories', href: '/categories' },
  { label: 'Offers', href: '/offers' },
] as const;

export const footerLinks = {
  company: [
    { label: 'About Us', href: '/about' },
    { label: 'Careers', href: '/careers' },
    { label: 'Press', href: '/press' },
  ],
  support: [
    { label: 'Help Center', href: '/help' },
    { label: 'Contact Us', href: '/contact' },
    { label: 'Returns', href: '/returns-policy' },
    { label: 'Shipping', href: '/shipping-policy' },
  ],
  legal: [
    { label: 'Privacy Policy', href: '/privacy' },
    { label: 'Terms of Service', href: '/terms' },
    { label: 'Cookie Policy', href: '/cookies' },
  ],
  seller: [
    { label: 'Sell on ShopVerse', href: '/seller/register' },
    { label: 'Seller Dashboard', href: '/seller' },
    { label: 'Seller Policies', href: '/seller-policies' },
  ],
} as const;
