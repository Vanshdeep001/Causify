'use client';

// =============================================
// Home Page — ShopVerse (Maximalist Edition)
// =============================================

import { motion } from 'framer-motion';
import { 
  ShoppingBag, 
  ArrowRight, 
  Star, 
  Truck, 
  Shield, 
  Headphones, 
  Sparkles, 
  Flame, 
  Percent, 
  ArrowUpRight,
  Plus,
  Volume2
} from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';

export default function HomePage() {
  const { isAuthenticated, user, logout } = useAuth();
  const marqueeItems = [
    "NEW WAVE COLLECTIONS OUT NOW",
    "LIMITED EDITION DROPS",
    "GET UP TO 70% DISCOUNT",
    "SECURE STRIPE & RAZORPAY INTEGRATIONS",
    "MULTI-VENDOR CAPABILITIES ENABLED",
    "EXPRESS 48-HOUR SHIPPINGS",
  ];

  // Animation variants for smooth entrance
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.15,
        delayChildren: 0.1,
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: { 
      opacity: 1, 
      y: 0,
      transition: { type: "spring" as const, stiffness: 80, damping: 15 }
    }
  };

  const cardVariants = {
    hidden: { opacity: 0, scale: 0.95 },
    visible: { 
      opacity: 1, 
      scale: 1,
      transition: { type: "spring" as const, stiffness: 60, damping: 16 }
    }
  };

  return (
    <main className="min-h-screen relative overflow-hidden selection:bg-[#C41E3A] selection:text-white" style={{ backgroundColor: 'var(--bg)' }}>
      {/* Texture Background Grid Overlay */}
      <div className="absolute inset-0 pattern-grid pointer-events-none z-0" />
      
      {/* ---- Infinite Scrolling Marquee Banner ---- */}
      <div className="relative z-10 bg-[#C41E3A] text-white border-b-4 border-[#1E1613] py-4 overflow-hidden shadow-md">
        <div className="marquee-container flex">
          <div className="marquee-content inline-flex gap-16 font-display text-sm tracking-widest uppercase font-extrabold whitespace-nowrap animate-marquee">
            {[...marqueeItems, ...marqueeItems].map((text, idx) => (
              <span key={idx} className="inline-flex items-center gap-3">
                <Sparkles size={16} className="text-[#F4EFE6] animate-pulse" />
                {text}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ---- Navigation Bar ---- */}
      <nav className="sticky top-0 z-50 bg-[#F4EFE6]/90 backdrop-blur-md border-b-4 border-[#1E1613] py-2.5 lg:py-3 transition-all duration-300">
        <div className="max-w-[1400px] mx-auto px-6 sm:px-10 lg:px-4 xl:px-16 w-full flex items-center justify-between gap-3 xl:gap-8">
          <Link href="/" className="flex items-center gap-3 group flex-shrink-0">
            <div className="w-9 h-9 lg:w-10 lg:h-10 border-4 border-[#1E1613] flex items-center justify-center bg-[#C41E3A] shadow-[3px_3px_0px_0px_#1E1613] group-hover:translate-x-[1px] group-hover:translate-y-[1px] group-hover:shadow-[2px_2px_0px_0px_#1E1613] transition-all duration-200">
              <span className="text-white font-black text-lg lg:text-xl font-serif">S</span>
            </div>
            <div>
              <span className="text-lg lg:text-xl xl:text-2xl font-extrabold font-display uppercase tracking-tight block leading-none group-hover:text-[#C41E3A] transition-colors duration-200">
                ShopVerse
              </span>
              <span className="text-[8px] lg:text-[9px] xl:text-[10px] font-bold tracking-wider uppercase text-[#C41E3A]">
                Marketplace Engine
              </span>
            </div>
          </Link>

          {/* Nav Links */}
          <div className="hidden lg:flex items-center gap-3 xl:gap-8 font-extrabold uppercase text-[11px] xl:text-xs tracking-wider whitespace-nowrap">
            <Link href="/products" className="hover:text-[#C41E3A] border-b-2 border-transparent hover:border-[#1E1613] pb-1 transition-all duration-200">Shop All</Link>
            <Link href="/categories" className="hover:text-[#C41E3A] border-b-2 border-transparent hover:border-[#1E1613] pb-1 transition-all duration-200">Categories</Link>
            <Link href="/offers" className="hover:text-[#C41E3A] border-b-2 border-transparent hover:border-[#1E1613] pb-1 transition-all duration-200">Today&apos;s Deals</Link>
            <Link href="/seller/register" className="hover:text-[#C41E3A] border-b-2 border-transparent hover:border-[#1E1613] pb-1 transition-all duration-200">Become a Seller</Link>
          </div>

          <div className="flex items-center gap-3.5 flex-shrink-0">
            <Link 
              href="/cart" 
              className="relative w-9 h-9 lg:w-10 lg:h-10 border-3 border-[#1E1613] bg-[#FDFBF7] flex items-center justify-center shadow-[3px_3px_0px_0px_#1E1613] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#1E1613] active:translate-y-[1px] active:shadow-[2px_2px_0px_0px_#1E1613] transition-all duration-200"
            >
              <ShoppingBag size={18} />
              <span className="absolute -top-1 -right-1 w-4.5 h-4.5 border-2 border-[#1E1613] bg-[#C41E3A] text-white text-[8px] font-black rounded-full flex items-center justify-center">
                2
              </span>
            </Link>

            {isAuthenticated && user ? (
              <div className="flex items-center gap-3">
                <span className="hidden sm:inline text-xs font-black uppercase text-[#1E1613]">
                  Hi, {user.firstName}!
                </span>
                <button
                  onClick={logout}
                  className="btn-brutal py-1.5 px-3 lg:py-2 lg:px-4 text-[10px] lg:text-xs font-extrabold shadow-[3px_3px_0px_0px_#1E1613] hover:shadow-[4px_4px_0px_0px_#1E1613] whitespace-nowrap cursor-pointer"
                >
                  Logout
                </button>
              </div>
            ) : (
              <Link href="/login" className="btn-brutal py-1.5 px-3 lg:py-2 lg:px-4 text-[10px] lg:text-xs font-extrabold shadow-[3px_3px_0px_0px_#1E1613] hover:shadow-[4px_4px_0px_0px_#1E1613] whitespace-nowrap">
                Portal Access
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* ---- Hero Section ---- */}
      <section className="relative z-10 pt-20 pb-28 border-b-4 border-[#1E1613]">
        <div className="max-w-[1400px] mx-auto px-6 sm:px-10 lg:px-16 w-full">
          <motion.div 
            className="grid lg:grid-cols-12 gap-10 xl:gap-16 items-center"
            initial="hidden"
            animate="visible"
            variants={containerVariants}
          >
            {/* Left Column — Dramatic Brand Identity */}
            <motion.div className="lg:col-span-7 flex flex-col items-start" variants={itemVariants}>
              <div className="badge-brutal mb-6 inline-flex items-center gap-2 bg-[#E25C3E] shadow-[3px_3px_0px_0px_#1E1613]">
                <Flame size={14} />
                LATEST RELEASES
              </div>

              <h1 className="text-6xl sm:text-8xl lg:text-7xl xl:text-8xl font-black mb-8 leading-[0.9] tracking-tighter font-display uppercase">
                EMBRACE <br />
                <span className="text-[#C41E3A] font-serif italic font-normal tracking-wide lowercase pr-3">the</span>
                EXTRA.
              </h1>

              <div className="border-4 border-[#1E1613] bg-[#FDFBF7] p-8 shadow-[8px_8px_0px_0px_#1E1613] mb-10 max-w-2xl relative">
                <div className="absolute top-0 right-0 w-8 h-8 border-b-4 border-l-4 border-[#1E1613] bg-[#C41E3A] flex items-center justify-center">
                  <Plus size={14} className="text-[#F4EFE6]" />
                </div>
                <p className="text-lg sm:text-xl font-medium leading-relaxed text-[#5C4A42]">
                  A decentralized multi-vendor retail platform designed to cut out the noise. Shop direct from approved designers, manage your orders seamlessly, and experience high-performance commerce.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-5 w-full sm:w-auto">
                <Link href="/products" className="btn-brutal text-md px-10 py-5 flex items-center justify-center shadow-[6px_6px_0px_0px_#1E1613] hover:shadow-[9px_9px_0px_0px_#C41E3A] transition-all duration-200">
                  EXPLORE THE VAULT
                  <ArrowRight size={20} className="ml-2" />
                </Link>
                <Link href="/seller/register" className="btn-brutal btn-brutal-secondary text-md px-10 py-5 flex items-center justify-center shadow-[6px_6px_0px_0px_#1E1613] hover:shadow-[9px_9px_0px_0px_#1E1613] transition-all duration-200">
                  START SELLING
                </Link>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-3 gap-6 sm:gap-12 mt-16 w-full pt-10 border-t-3 border-[#1E1613]">
                {[
                  { value: '50K+', label: 'Products' },
                  { value: '10K+', label: 'Sellers' },
                  { value: '1.2M', label: 'Customers' },
                ].map((stat) => (
                  <div key={stat.label} className="border-r-2 border-[#1E1613] last:border-0 pr-4">
                    <div
                      className="text-3xl sm:text-4xl font-black tracking-tight"
                      style={{
                        fontFamily: "'Outfit', system-ui, sans-serif",
                        color: 'var(--primary)',
                      }}
                    >
                      {stat.value}
                    </div>
                    <div
                      className="text-xs sm:text-sm font-bold uppercase tracking-wider mt-1 text-[#8E786E]"
                    >
                      {stat.label}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Right Column — Editorial Brutalist Card Box */}
            <motion.div className="lg:col-span-5 relative flex items-center justify-center" variants={cardVariants}>
              <div className="relative w-full max-w-[320px] sm:max-w-[380px] lg:max-w-[340px] xl:max-w-[400px] aspect-[4/5] z-10">
                {/* Thick Red Background offset block */}
                <div className="absolute inset-0 bg-[#C41E3A] border-4 border-[#1E1613] translate-x-5 translate-y-5 shadow-[4px_4px_0px_0px_#1E1613]" />
                
                {/* Main Card */}
                <div className="absolute inset-0 bg-[#FDFBF7] border-4 border-[#1E1613] p-8 flex flex-col justify-between shadow-[4px_4px_0px_0px_#1E1613]">
                  <div className="flex justify-between items-center border-b-3 border-[#1E1613] pb-4">
                    <span className="font-extrabold uppercase text-xs tracking-widest font-display">PREMIUM COLLECTION</span>
                    <span className="badge-brutal bg-[#1E1613] text-[#FDFBF7] py-1 px-3 text-[10px] shadow-none border-2">DROP 01</span>
                  </div>

                  {/* Textured Image Frame */}
                  <div className="my-6 flex-grow border-4 border-[#1E1613] bg-[#F4EFE6] relative flex items-center justify-center overflow-hidden group cursor-pointer">
                    <div className="absolute inset-0 pattern-stripes opacity-15" />
                    <div className="w-24 h-24 border-3 border-[#1E1613] bg-[#C41E3A] flex items-center justify-center rotate-[8deg] shadow-[4px_4px_0px_0px_#1E1613] group-hover:rotate-[0deg] group-hover:scale-105 transition-all duration-300 ease-out">
                      <ShoppingBag size={48} className="text-white" />
                    </div>
                  </div>

                  {/* Pricing / Call-out */}
                  <div className="pt-4 border-t-3 border-[#1E1613] flex justify-between items-end">
                    <div>
                      <h3 className="font-black text-xl leading-none font-display uppercase">CHUNKY RAW SNEAKER</h3>
                      <p className="text-xs font-bold text-[#8E786E] uppercase mt-1">Limited Release 2026</p>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-2xl font-extrabold text-[#C41E3A] font-serif italic leading-none">₹8,499</span>
                    </div>
                  </div>
                </div>

                {/* Overlapping Brutalist Tag */}
                <div className="absolute -bottom-6 -left-6 bg-[#E25C3E] text-white border-3 border-[#1E1613] py-3.5 px-6 font-black shadow-[4px_4px_0px_0px_#1E1613] rotate-[-8deg] z-20 flex items-center gap-2 hover:rotate-[0deg] transition-all duration-300 cursor-default">
                  <Percent size={18} />
                  <span className="font-display tracking-wider text-sm uppercase">25% OFF INITIAL RELEASE</span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ---- Core Structured Offer Grid ---- */}
      <section className="section z-10 relative border-b-4 border-[#1E1613] bg-[#FDFBF7] py-24">
        <div className="max-w-[1400px] mx-auto px-6 sm:px-10 lg:px-16 w-full">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-16">
            <div>
              <div className="badge-brutal mb-4 inline-flex items-center gap-1.5 bg-[#1E1613] shadow-[3px_3px_0px_0px_#C41E3A]">
                <Volume2 size={14} className="text-white" />
                <span className="text-white">HOT RELEASE</span>
              </div>
              <h2 className="text-4xl sm:text-6xl font-black font-display uppercase tracking-tight">
                WEEKLY SPECIAL <span className="text-[#C41E3A] font-serif italic font-normal lowercase">catalogue</span>
              </h2>
            </div>
            <Link 
              href="/products" 
              className="group font-black uppercase text-sm tracking-wider flex items-center gap-1.5 hover:text-[#C41E3A] transition-colors duration-200 mt-6 md:mt-0"
            >
              BROWSE ENTIRE VAULT
              <ArrowUpRight size={18} className="group-hover:translate-x-1 group-hover:translate-y-[-1px] transition-transform duration-200" />
            </Link>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-10">
            {[
              { 
                title: 'BRUTAL CLASSIC HOODIE', 
                price: '₹2,499', 
                oldPrice: '₹3,999', 
                desc: 'Heavyweight loopback cotton with custom raw hem details.', 
                tag: 'Hot Drop',
                rating: '4.8',
                color: 'Crimson Red'
              },
              { 
                title: 'BEIGE CANVAS TOTE', 
                price: '₹1,899', 
                oldPrice: '₹2,999', 
                desc: 'Water-resistant natural canvas featuring heavy load nylon straps.', 
                tag: 'New Design',
                rating: '4.9',
                color: 'Warm Sand'
              },
              { 
                title: 'RED CRUSH TRAINERS', 
                price: '₹5,999', 
                oldPrice: '₹7,999', 
                desc: 'Full grain leather accents with robust vulcanized rubber sole.', 
                tag: 'Limited Stock',
                rating: '4.7',
                color: 'Scarlet Red'
              }
            ].map((prod, idx) => (
              <div 
                key={idx} 
                className="border-4 border-[#1E1613] bg-[#F4EFE6] p-8 flex flex-col justify-between relative shadow-[6px_6px_0px_0px_#1E1613] hover:translate-x-[-4px] hover:translate-y-[-4px] hover:shadow-[10px_10px_0px_0px_#C41E3A] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[3px_3px_0px_0px_#1E1613] transition-all duration-300 ease-out group"
              >
                {/* Product Card Top */}
                <div>
                  <div className="flex justify-between items-center mb-6">
                    <span className="badge-brutal bg-[#E25C3E]">{prod.tag}</span>
                    <div className="flex items-center gap-1.5 font-bold text-sm bg-[#FDFBF7] border-2 border-[#1E1613] py-1 px-2.5 shadow-[2px_2px_0px_0px_#1E1613]">
                      <Star size={14} fill="var(--primary)" style={{ color: 'var(--primary)' }} />
                      {prod.rating}
                    </div>
                  </div>

                  {/* Image Block */}
                  <div className="w-full h-56 border-4 border-[#1E1613] bg-[#FDFBF7] relative overflow-hidden mb-6 flex items-center justify-center">
                    <div className="absolute inset-0 pattern-stripes opacity-5" />
                    <ShoppingBag size={64} className="text-[#C41E3A] group-hover:scale-110 transition-transform duration-300 ease-out" />
                  </div>

                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] uppercase tracking-wider font-extrabold bg-[#C41E3A] text-white py-0.5 px-2 border border-[#1E1613]">
                      {prod.color}
                    </span>
                  </div>

                  <h3 className="font-black text-2xl font-display uppercase tracking-tight mb-2 group-hover:text-[#C41E3A] transition-colors duration-200">{prod.title}</h3>
                  <p className="text-sm text-[#5C4A42] font-semibold mb-6">{prod.desc}</p>
                </div>

                {/* Product Card Bottom */}
                <div className="pt-6 border-t-3 border-[#1E1613] flex justify-between items-center">
                  <div>
                    <span className="text-3xl font-black text-[#C41E3A] font-serif italic">{prod.price}</span>
                    <span className="text-xs text-[#8E786E] line-through ml-2 font-bold">{prod.oldPrice}</span>
                  </div>
                  <button className="btn-brutal py-2.5 px-5 text-xs font-black shadow-[3px_3px_0px_0px_#1E1613]">
                    ADD TO CART
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Interactive Drop Countdown Section ---- */}
      <section className="relative z-10 border-b-4 border-[#1E1613] bg-[#C41E3A] text-[#FDFBF7] overflow-hidden py-24">
        <div className="absolute inset-0 pattern-stripes opacity-15 pointer-events-none" />
        <div className="max-w-[1400px] mx-auto px-6 sm:px-10 lg:px-16 w-full relative z-10">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <span className="badge-brutal bg-[#1E1613] text-[#FDFBF7] mb-6 inline-block shadow-[3px_3px_0px_0px_#FDFBF7] border-[#FDFBF7]">
                NEXT DROP TIMER
              </span>
              <h2 className="text-5xl sm:text-7xl font-black font-display uppercase leading-none mb-6">
                LIMITED SERIES <br />
                <span className="text-[#1E1613] underline decoration-4 decoration-[#FDFBF7]">DROP 02</span> ARRIVING
              </h2>
              <p className="text-lg font-bold uppercase tracking-wider text-[#FDFBF7]/90 max-w-lg mb-8">
                Strict limits of 2 items per customer. Pre-authorization is recommended. Join the drop channel to qualify.
              </p>
              <div className="flex gap-4">
                <button className="btn-brutal bg-[#1E1613] text-[#FDFBF7] hover:bg-[#FDFBF7] hover:text-[#1E1613] shadow-[5px_5px_0px_0px_#FDFBF7] transition-all duration-200">
                  PRE-REGISTER NOW
                </button>
              </div>
            </div>

            {/* Countdown visual box */}
            <div className="border-4 border-[#1E1613] bg-[#FDFBF7] text-[#1E1613] p-10 shadow-[8px_8px_0px_0px_#1E1613] flex flex-col justify-center items-center text-center">
              <div className="text-xs font-black uppercase tracking-widest text-[#8E786E] mb-8">
                ESTIMATED RELATIVE LAUNCH
              </div>
              <div className="flex gap-4 sm:gap-6 justify-center items-center">
                {[
                  { value: '14', unit: 'DAYS' },
                  { value: '08', unit: 'HOURS' },
                  { value: '45', unit: 'MINS' },
                ].map((time, idx) => (
                  <div key={idx} className="flex flex-col items-center">
                    <div className="text-5xl sm:text-7xl font-black font-display bg-[#F4EFE6] border-3 border-[#1E1613] w-20 sm:w-28 h-20 sm:h-28 flex items-center justify-center shadow-[4px_4px_0px_0px_#1E1613] hover:translate-y-[-2px] transition-transform duration-200">
                      {time.value}
                    </div>
                    <span className="text-xs font-black uppercase tracking-wider mt-4 text-[#5C4A42]">
                      {time.unit}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---- Brutalist Core Features Section ---- */}
      <section className="py-24 relative z-10 border-b-4 border-[#1E1613]">
        <div className="max-w-[1400px] mx-auto px-6 sm:px-10 lg:px-16 w-full">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { icon: Truck, title: 'EXPRESS COURIER', desc: 'Secure packaging, tracked transit.' },
              { icon: Shield, title: 'PAYMENT INTEGRITY', desc: 'Encrypted Razorpay & Stripe pipelines.' },
              { icon: Headphones, title: 'SELLER CHANNELS', desc: 'Direct dialogue with verified creators.' },
              { icon: Star, title: 'VERIFIED REVIEWS', desc: 'Authenticated customer experiences only.' },
            ].map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="flex gap-4 p-6 border-4 border-[#1E1613] bg-[#FDFBF7] shadow-[6px_6px_0px_0px_#1E1613] hover:translate-x-[-3px] hover:translate-y-[-3px] hover:shadow-[9px_9px_0px_0px_#C41E3A] transition-all duration-300 ease-out"
              >
                <div className="w-14 h-14 border-3 border-[#1E1613] bg-[#C41E3A] flex items-center justify-center shrink-0 shadow-[3px_3px_0px_0px_#1E1613] text-white">
                  <Icon size={24} />
                </div>
                <div>
                  <div className="font-extrabold text-sm uppercase tracking-wide font-display">
                    {title}
                  </div>
                  <div className="text-xs text-[#5C4A42] font-semibold mt-1">
                    {desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Newsletter / Release Join Form ---- */}
      <section className="section relative z-10 bg-[#C41E3A] text-white py-24 border-b-4 border-[#1E1613] overflow-hidden">
        <div className="absolute inset-0 pattern-stripes opacity-15 pointer-events-none" />
        <div className="max-w-[1400px] mx-auto px-6 sm:px-10 lg:px-16 w-full relative z-10 flex flex-col items-center text-center">
          <h2 className="text-5xl sm:text-7xl font-black font-display uppercase tracking-tight mb-4 drop-shadow-[3px_3px_0px_#1E1613]">
            JOIN THE SELLER RELEASE CIRCLE
          </h2>
          <p className="text-lg max-w-lg font-bold uppercase mb-10 text-[#FDFBF7] tracking-wider leading-relaxed">
            Get instant alerts on limited releases, coupons, and seller inventory refreshes.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 w-full max-w-xl">
            <input 
              type="email" 
              placeholder="ENTER.YOUR.EMAIL@DOMAIN.COM" 
              className="flex-grow p-5 border-4 border-[#1E1613] bg-[#FDFBF7] text-[#1E1613] font-bold uppercase placeholder-[#8E786E] text-sm focus:outline-none focus:ring-0 shadow-[4px_4px_0px_0px_#1E1613]"
              required
            />
            <button className="btn-brutal bg-[#1E1613] text-[#FDFBF7] border-4 border-[#1E1613] py-5 px-8 hover:bg-[#FDFBF7] hover:text-[#1E1613] shadow-[4px_4px_0px_0px_#FDFBF7] transition-all duration-200">
              SUBSCRIBE NOW
            </button>
          </div>
        </div>
      </section>

      {/* ---- Footer ---- */}
      <footer className="py-20 relative z-10" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="max-w-[1400px] mx-auto px-6 sm:px-10 lg:px-16 w-full">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-12 border-b-4 border-[#1E1613] pb-16 mb-12">
            <div>
              <h4 className="font-extrabold uppercase text-xs tracking-widest text-[#8E786E] mb-6">VAULT COLLECTION</h4>
              <ul className="flex flex-col gap-3 text-sm font-bold uppercase">
                <li><Link href="/products" className="hover:text-[#C41E3A] transition-colors duration-150">All Release Items</Link></li>
                <li><Link href="/categories" className="hover:text-[#C41E3A] transition-colors duration-150">Apparel & Hoodies</Link></li>
                <li><Link href="/categories" className="hover:text-[#C41E3A] transition-colors duration-150">Street Sneakers</Link></li>
                <li><Link href="/offers" className="hover:text-[#C41E3A] transition-colors duration-150">Discounted Lots</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-extrabold uppercase text-xs tracking-widest text-[#8E786E] mb-6">PLATFORM ENGINE</h4>
              <ul className="flex flex-col gap-3 text-sm font-bold uppercase">
                <li><Link href="/seller/register" className="hover:text-[#C41E3A] transition-colors duration-150">Become Approved Seller</Link></li>
                <li><Link href="/seller" className="hover:text-[#C41E3A] transition-colors duration-150">Seller Dashboard Access</Link></li>
                <li><Link href="/admin" className="hover:text-[#C41E3A] transition-colors duration-150">Admin Terminal</Link></li>
                <li><Link href="/docs" className="hover:text-[#C41E3A] transition-colors duration-150">API Engine Specs</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-extrabold uppercase text-xs tracking-widest text-[#8E786E] mb-6">SUPPORT PORTAL</h4>
              <ul className="flex flex-col gap-3 text-sm font-bold uppercase">
                <li><Link href="/support" className="hover:text-[#C41E3A] transition-colors duration-150">Help Center</Link></li>
                <li><Link href="/shipping" className="hover:text-[#C41E3A] transition-colors duration-150">Courier Tracking System</Link></li>
                <li><Link href="/returns" className="hover:text-[#C41E3A] transition-colors duration-150">Refund & Returns Claim</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-extrabold uppercase text-xs tracking-widest text-[#8E786E] mb-6">CREDITS & STATS</h4>
              <p className="text-sm text-[#5C4A42] font-semibold leading-relaxed">
                ShopVerse is an enterprise-grade multi-vendor storefront built from scratch using next.js, express, mongo, and redis.
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between">
            <span className="font-black text-2xl tracking-widest font-display">SHOPVERSE</span>
            <span className="text-xs font-extrabold uppercase text-[#8E786E] tracking-wider mt-4 sm:mt-0">
              © 2026 ShopVerse Engine Inc. All rights reserved. Codebases compiled successfully.
            </span>
          </div>
        </div>
      </footer>
    </main>
  );
}
