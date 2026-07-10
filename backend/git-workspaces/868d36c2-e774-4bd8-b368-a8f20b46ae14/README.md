# 🛍️ ShopVerse (Mock Application Sandbox)

> ShopVerse is a high-fidelity reference sandbox and mock application designed for multi-vendor e-commerce testing, benchmarking, integrations, and prototyping.
>
> Built with Next.js, Express.js, MongoDB, and Redis, it simulates a production-grade multi-tenant marketplace to serve as a robust testbed for QA automation, payment gateway integrations, and API evaluation.

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=next.js&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-404D59?style=for-the-badge)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)

---

## 🏗️ Architecture

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 14, React, TypeScript, Tailwind CSS, Shadcn UI |
| **Backend** | Express.js, TypeScript, Mongoose |
| **Database** | MongoDB Atlas |
| **Cache** | Redis |
| **Auth** | JWT + Google OAuth |
| **Payments** | Stripe + Razorpay |
| **Storage** | Cloudinary |
| **Email** | Nodemailer |

## 🧪 Mock & Simulation Capabilities

ShopVerse is tailored to simulate real-world e-commerce scenarios for testing and demonstration purposes:
* **Mock Authentication Flows:** Secure HTTP-only cookies and JWT logic ready-to-test with pre-configured mock credentials.
* **Multi-Role Simulation:** Out-of-the-box configurations for simulating Customers, Sellers (Vendors), and Administrators to test authorization matrices.
* **Flexible Database Sandbox:** Easily interfaces with MongoDB Atlas or local Docker MongoDB instances for data teardown/setup cycles.
* **Mock Integration Points:** Ready placeholders and skeletons for payment simulation (Stripe/Razorpay), mailing, and image storage.

## 📁 Project Structure

```
shopverse/
├── client/          # Next.js frontend
├── server/          # Express.js backend
├── shared/          # Shared types & constants
├── docker-compose.yml
└── package.json     # Monorepo root
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- Docker & Docker Compose
- npm 9+

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-username/shopverse.git
cd shopverse

# 2. Install dependencies
npm install

# 3. Copy environment variables
cp .env.example .env

# 4. Start MongoDB & Redis
docker-compose up -d

# 5. Build shared types
npm run build:shared

# 6. Start development servers
npm run dev
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start both frontend and backend in dev mode |
| `npm run dev:server` | Start backend only |
| `npm run dev:client` | Start frontend only |
| `npm run build` | Build all packages |
| `npm run docker:up` | Start Docker containers |
| `npm run docker:down` | Stop Docker containers |

## 🔐 Environment Variables

See [`.env.example`](.env.example) for all required variables.

## 📄 License

MIT
