// ============================================================================

const DEBUG = false;
const log = (...a) => { if (DEBUG) console.log(...a); };
// Upgrade Page - Stripe Integration with Monthly & Yearly Plans
// ============================================================================

'use strict';

// Stripe Price IDs
const STRIPE_PRICES = {
  monthly: 'price_1TWOAXE3FV5aR9qEvdBOx8hI', // $9.99/month
  yearly:  'price_1TWOAXE3FV5aR9qE9NUCu9Ur'  // $99/year
};

// State
let currentPlan = 'monthly'; // 'monthly' or 'yearly'

// DOM Elements (set in DOMContentLoaded)
let toggleSwitch, monthlyOption, yearlyOption, proMonthly, proYearly, monthlyButton, yearlyButton;

// ============================================================================
// PLAN TOGGLE
// ============================================================================

function switchPlan(plan) {
  currentPlan = plan;

  if (plan === 'yearly') {
    toggleSwitch?.classList.add('yearly');
    monthlyOption?.classList.remove('active');
    yearlyOption?.classList.add('active');
    if (proMonthly) proMonthly.style.display = 'none';
    if (proYearly) proYearly.style.display = 'block';
  } else {
    toggleSwitch?.classList.remove('yearly');
    monthlyOption?.classList.add('active');
    yearlyOption?.classList.remove('active');
    if (proMonthly) proMonthly.style.display = 'block';
    if (proYearly) proYearly.style.display = 'none';
  }

  log(`💳 Plan switched to: ${plan}`);
}

// ============================================================================
// STRIPE CHECKOUT
// ============================================================================

async function startCheckout(plan) {
  log(`🚀 Starting ${plan} checkout...`);

  // Read promo code from URL (?promo=PRODUCTHUNT) — auto-applies at checkout
  const urlPromo = new URLSearchParams(window.location.search).get('promo') || '';

  try {
    const { userEmail } = await chrome.storage.local.get(['userEmail']);

    // Create checkout session via backend
    const response = await fetch('https://www.fauxspy.com/api/create-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        plan,
        email: userEmail || undefined,
        ...(urlPromo ? { promoCode: urlPromo } : {})
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Checkout failed: ${error}`);
    }

    const data = await response.json();
    const { url, promoApplied } = data;

    // Validate URL before redirecting (prevent open redirect)
    if (!url || (!url.startsWith('https://checkout.stripe.com/') && !url.startsWith('https://fauxspy.com/') && !url.startsWith('https://www.fauxspy.com/'))) {
      throw new Error('Invalid checkout URL received from server');
    }

    // Warn if promo code was expected but didn't apply
    if (urlPromo && promoApplied === false) {
      const cont = confirm(`Promo code "${urlPromo.toUpperCase()}" wasn't recognized — you'll be charged the full price.\n\nContinue anyway?`);
      if (!cont) return;
    }

    log('✅ Redirecting to Stripe Checkout...');
    window.location.href = url;
    
  } catch (error) {
    console.error('❌ Checkout error:', error);
    alert(`Failed to start checkout: ${error.message}\n\nPlease try again or contact support.`);
  }
}


// ============================================================================
// CHECK FOR SUCCESSFUL PAYMENT
// ============================================================================

async function checkPaymentStatus() {
  // After checkout, Stripe redirects to fauxspy.com/success.html where the
  // license key is emailed to the user. The user then enters it in Settings.
  const urlParams = new URLSearchParams(window.location.search);
  const cancelled = urlParams.get('cancelled');

  if (cancelled === 'true') {
    log('❌ Payment cancelled');
    alert('Payment was cancelled. No charges were made.');
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

async function init() {
  log('🚀 Upgrade page loaded');

  // Cache DOM elements
  toggleSwitch = document.getElementById('toggleSwitch');
  monthlyOption = document.getElementById('monthlyOption');
  yearlyOption = document.getElementById('yearlyOption');
  proMonthly = document.getElementById('proMonthly');
  proYearly = document.getElementById('proYearly');
  monthlyButton = document.getElementById('monthlyButton');
  yearlyButton = document.getElementById('yearlyButton');
  const videoMonthlyButton = document.getElementById('videoMonthlyButton');
  const videoYearlyButton = document.getElementById('videoYearlyButton');

  // Attach toggle listeners
  toggleSwitch?.addEventListener('click', () => switchPlan(currentPlan === 'monthly' ? 'yearly' : 'monthly'));
  monthlyOption?.addEventListener('click', () => switchPlan('monthly'));
  yearlyOption?.addEventListener('click', () => switchPlan('yearly'));

  // Attach checkout listeners
  monthlyButton?.addEventListener('click', () => startCheckout('monthly'));
  yearlyButton?.addEventListener('click', () => startCheckout('yearly'));
  videoMonthlyButton?.addEventListener('click', () => startCheckout('video-monthly'));
  videoYearlyButton?.addEventListener('click', () => startCheckout('video-yearly'));

  // Check for payment callback
  await checkPaymentStatus();

  // Load user's current license
  const { license } = await chrome.storage.local.get('license');

  if (license?.isPro) {
    log('✅ User already has Pro');
  }

  log('💳 Stripe integration ready');
  log(`   Monthly: ${STRIPE_PRICES.monthly}`);
  log(`   Yearly: ${STRIPE_PRICES.yearly}`);
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', init);
