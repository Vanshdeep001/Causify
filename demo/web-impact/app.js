/* This file is the VICTIM in most of the demo triggers.
   Keep it open on the second client to watch the warnings arrive. */

import { calculateTotal, formatMoney, TAX_RATE } from './utils.js';

const ITEMS = [
  { name: 'Keyboard', price: 45.0, qty: 3 },
  { name: 'Mouse', price: 25.0, qty: 1 },
];

function render() {
  // Depends on  id="total-display"  in index.html  (TRIGGER 1)
  const totalEl = document.getElementById('total-display');
  const subtotal = calculateTotal(ITEMS);
  const withTax = subtotal * (1 + TAX_RATE);
  totalEl.textContent = formatMoney(withTax);
}

function bind() {
  // Depends on  id="recalc-btn"  in index.html
  const btn = document.getElementById('recalc-btn');
  btn.addEventListener('click', render);
}

// Depends on  class="cart-item"  in index.html
function countRows() {
  return document.getElementsByClassName('cart-item').length;
}

render();
bind();
console.log(`${countRows()} rows rendered`);
