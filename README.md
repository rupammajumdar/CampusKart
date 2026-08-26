# 🎓 CampusKart — NIT Raipur Campus Marketplace Platform

![CampusKart](IMAGES/gate_nitrr_2026.jpg)

**CampusKart** is a trusted peer-to-peer campus marketplace designed exclusively for students of **National Institute of Technology Raipur (NIT Raipur)** to buy, sell, and rent lab equipment, formal wear, books, shoes, electronics, and hostel essentials safely within the campus community.

Developed by **[Rupam](https://www.linkedin.com/in/rupam2007/)** (NIT Raipur).

---

## 🌐 Live Deployment & Links

- 🚀 **Vercel Deployment**: [https://vercel.com/rupammajumdars-projects/campus-kart](https://vercel.com/rupammajumdars-projects/campus-kart)
- 📦 **GitHub Repository**: [https://github.com/rupammajumdar/CampusKart](https://github.com/rupammajumdar/CampusKart)
- 👨‍💻 **Developer LinkedIn**: [https://www.linkedin.com/in/rupam2007/](https://www.linkedin.com/in/rupam2007/)

---

## ✨ Key Features

- **Verified Student Authentication**: Magic link & password authentication with NIT Raipur email verification.
- **Buy, Sell & Rent Marketplace**: Multi-category support (Lab Equipment, Formal Wear, Shoes, Books, etc.) with custom rental rates.
- **Real-Time Database Statistics**: Live MongoDB Atlas aggregation tracking verified student count, active listings, and rating percentages.
- **Real-Time Messaging**: Built-in chat system for buyers and sellers to discuss item details and pickup locations.
- **Lister Dashboard & Moderation Queue**: Seller inventory manager and admin moderation panel.
- **Anime-Technic Design System**: Sleek linework, ambient glows, responsive layouts, and dark topbar header.

---

## 🛠️ Technology Stack

- **Frontend**: HTML5, Vanilla CSS3, ES6 JavaScript, Google Fonts (Sora, Inter, JetBrains Mono)
- **Backend**: Node.js, Express.js (Serverless architecture)
- **Database**: MongoDB Atlas (Mongoose ODM)
- **Hosting**: Vercel (`vercel.json` serverless function rewrites)

---

## 🚀 Quick Start (Local Development)

1. **Clone Repository**:
   ```bash
   git clone https://github.com/rupammajumdar/CampusKart.git
   cd CampusKart
   ```

2. **Install Backend Dependencies**:
   ```bash
   cd backend
   npm install
   ```

3. **Environment Setup**:
   Create a `.env` file in the `backend/` directory:
   ```env
   PORT=5000
   MONGODB_URI=your_mongodb_atlas_uri
   JWT_SECRET=your_jwt_secret
   ```

4. **Run Server**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:5000/index.html` in your browser.
