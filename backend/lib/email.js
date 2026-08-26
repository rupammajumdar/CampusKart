const nodemailer = require('nodemailer');
const { Resend } = require('resend');

// ── Transporters Setup ────────────────────────────────────────────────────────
let resendTransporter = null;
if (process.env.RESEND_API_KEY && !process.env.RESEND_API_KEY.includes('placeholder') && !process.env.RESEND_API_KEY.includes('dummy')) {
  try {
    resendTransporter = new Resend(process.env.RESEND_API_KEY);
  } catch (e) {
    console.warn('Resend init warning:', e.message);
  }
}

let smtpTransporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  try {
    smtpTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  } catch (e) {
    console.warn('SMTP init warning:', e.message);
  }
} else if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  try {
    smtpTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  } catch (e) {
    console.warn('Gmail init warning:', e.message);
  }
}

const FROM = process.env.FROM_EMAIL || process.env.RESEND_FROM || 'CampusKart <onboarding@resend.dev>';

function getAppUrl() {
  if (process.env.APP_URL && !process.env.APP_URL.includes('localhost')) {
    return process.env.APP_URL.replace(/\/$/, '');
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`.replace(/\/$/, '');
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`.replace(/\/$/, '');
  }
  return (process.env.APP_URL || 'http://localhost:5000').replace(/\/$/, '');
}

const APP_URL = getAppUrl();

// ─── Shared email wrapper ────────────────────────────────────────────────────
async function sendEmail({ to, subject, html }) {
  // 1. Try SMTP (Gmail or custom SMTP server) first if configured
  if (smtpTransporter) {
    try {
      const info = await smtpTransporter.sendMail({
        from: FROM,
        to,
        subject,
        html,
      });
      console.log(`✅ Email sent via SMTP to ${to}: ${info.messageId}`);
      return { ok: true, id: info.messageId };
    } catch (err) {
      console.error(`⚠️ SMTP send failed to ${to}:`, err.message);
    }
  }

  // 2. Try Resend if configured
  if (resendTransporter) {
    try {
      const { data, error } = await resendTransporter.emails.send({
        from: FROM,
        to,
        subject,
        html,
      });
      if (error) {
        console.error('⚠️ Resend error:', error.message || error);
        return { ok: false, error: error.message || error };
      }
      console.log(`✅ Email sent via Resend to ${to}: ${data?.id}`);
      return { ok: true, id: data ? data.id : 'sent' };
    } catch (err) {
      console.error(`⚠️ Resend send exception to ${to}:`, err.message);
      return { ok: false, error: err.message };
    }
  }

  console.log(`ℹ️ No active email transporter configured. Verification link logged in console for ${to}.`);
  return { ok: false, error: 'No active email transporter configured' };
}

// ─── Email templates ─────────────────────────────────────────────────────────

function baseTemplate(content) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8"/>
    <style>
      body { font-family: 'Inter', Arial, sans-serif; background: #f4f4f5; margin:0; padding:0; }
      .wrapper { max-width: 560px; margin: 40px auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.07); }
      .header { background: linear-gradient(135deg, #6c47ff 0%, #4f8ef7 100%); padding: 32px 40px; }
      .header h1 { color: #fff; margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.3px; }
      .header p { color: rgba(255,255,255,0.82); margin: 4px 0 0; font-size: 13px; }
      .body { padding: 32px 40px; color: #1c1c1e; font-size: 15px; line-height: 1.6; }
      .btn { display: inline-block; margin: 24px 0 8px; padding: 14px 28px; background: linear-gradient(135deg, #6c47ff, #4f8ef7); color: #fff !important; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 15px; }
      .footer { padding: 20px 40px; background: #f9f9fb; border-top: 1px solid #e5e5ea; color: #8e8e93; font-size: 12px; text-align: center; }
      .badge { display: inline-block; background: #eef2ff; color: #6c47ff; border-radius: 6px; padding: 2px 10px; font-size: 13px; font-weight: 600; }
      .divider { border: none; border-top: 1px solid #e5e5ea; margin: 20px 0; }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="header">
        <h1>🎓 CampusKart</h1>
        <p>Your campus marketplace — NIT Raipur</p>
      </div>
      <div class="body">${content}</div>
      <div class="footer">CampusKart is exclusively for verified NIT Raipur students.<br/>© ${new Date().getFullYear()} CampusKart</div>
    </div>
  </body>
  </html>`;
}

// 1. Email verification
async function sendVerificationEmail(user, token) {
  const link = `${APP_URL}/api/auth/verify-email?token=${token}`;
  console.log(`\n======================================================`);
  console.log(`📧 VERIFICATION EMAIL FOR: ${user.email}`);
  console.log(`🔗 VERIFICATION LINK: ${link}`);
  console.log(`======================================================\n`);
  const result = await sendEmail({
    to: user.email,
    subject: '✅ Verify your CampusKart email',
    html: baseTemplate(`
      <p>Hi <strong>${user.firstName}</strong>,</p>
      <p>Welcome to CampusKart! Click the button below to verify your campus email and activate your account.</p>
      <a href="${link}" class="btn">Verify Email Address</a>
      <hr class="divider"/>
      <p style="font-size:13px; color:#8e8e93;">This link expires in <strong>30 minutes</strong>. If you didn't create a CampusKart account, you can safely ignore this email.</p>
    `),
  });
  return { ...result, link };
}

// 2. Magic link login
async function sendMagicLinkEmail(user, token) {
  const link = `${APP_URL}/api/auth/magic-verify?token=${token}`;
  return sendEmail({
    to: user.email,
    subject: '🔗 Your CampusKart magic login link',
    html: baseTemplate(`
      <p>Hi <strong>${user.firstName}</strong>,</p>
      <p>Here's your one-time login link for CampusKart. Click it to sign in instantly — no password needed.</p>
      <a href="${link}" class="btn">Sign In to CampusKart</a>
      <hr class="divider"/>
      <p style="font-size:13px; color:#8e8e93;">This link expires in <strong>30 minutes</strong> and can only be used once. If you didn't request this, ignore this email.</p>
    `),
  });
}

// 3. Password reset
async function sendPasswordResetEmail(user, token) {
  const link = `${APP_URL}/reset-password.html?token=${token}`;
  return sendEmail({
    to: user.email,
    subject: '🔒 Reset your CampusKart password',
    html: baseTemplate(`
      <p>Hi <strong>${user.firstName}</strong>,</p>
      <p>We received a request to reset your password. Click the button below to set a new one.</p>
      <a href="${link}" class="btn">Reset Password</a>
      <hr class="divider"/>
      <p style="font-size:13px; color:#8e8e93;">This link expires in <strong>30 minutes</strong>. If you didn't request a password reset, you can safely ignore this email.</p>
    `),
  });
}

// 4. Listing approved
async function sendListingApprovedEmail(user, listing) {
  const link = `${APP_URL}/item.html?id=${listing._id}`;
  return sendEmail({
    to: user.email,
    subject: '🎉 Your listing is now live on CampusKart!',
    html: baseTemplate(`
      <p>Hi <strong>${user.firstName}</strong>,</p>
      <p>Great news — your listing has been approved by our moderation team and is now <strong>live</strong> on CampusKart!</p>
      <p><span class="badge">${listing.category}</span>&nbsp;&nbsp;<strong>${listing.title}</strong></p>
      <a href="${link}" class="btn">View Your Listing</a>
      <p style="font-size:13px; color:#8e8e93;">Students can now see your item and express interest. You'll get notified when someone is interested!</p>
    `),
  });
}

// 5. Listing rejected
async function sendListingRejectedEmail(user, listing, reason) {
  return sendEmail({
    to: user.email,
    subject: '⚠️ Your CampusKart listing needs changes',
    html: baseTemplate(`
      <p>Hi <strong>${user.firstName}</strong>,</p>
      <p>Your listing <strong>"${listing.title}"</strong> was reviewed and couldn't be approved at this time.</p>
      <p><strong>Reason:</strong></p>
      <blockquote style="border-left:3px solid #6c47ff; margin:12px 0; padding:8px 16px; background:#f4f0ff; border-radius:4px;">${reason}</blockquote>
      <p>You can edit your listing and resubmit it for review from your dashboard.</p>
      <a href="${APP_URL}/lister-dashboard.html" class="btn">Go to My Dashboard</a>
    `),
  });
}

// 6. Someone interested in your listing
async function sendInterestNotificationEmail(seller, buyer, listing) {
  const link = `${APP_URL}/messages.html?listing=${listing._id}&user=${buyer._id}`;
  return sendEmail({
    to: seller.email,
    subject: `👀 ${buyer.firstName} is interested in your listing`,
    html: baseTemplate(`
      <p>Hi <strong>${seller.firstName}</strong>,</p>
      <p><strong>${buyer.firstName} ${buyer.lastName}</strong> (<span class="badge">${buyer.branch} · ${buyer.year}</span>) is interested in your listing:</p>
      <p><strong>"${listing.title}"</strong></p>
      <a href="${link}" class="btn">View Message Thread</a>
      <p style="font-size:13px; color:#8e8e93;">Open the chat to discuss details, agree on a price, and set up a meetup.</p>
    `),
  });
}

// 7. Item reserved for you (buyer notification)
async function sendItemReservedEmail(buyer, listing) {
  const link = `${APP_URL}/item.html?id=${listing._id}`;
  return sendEmail({
    to: buyer.email,
    subject: `✅ "${listing.title}" has been reserved for you`,
    html: baseTemplate(`
      <p>Hi <strong>${buyer.firstName}</strong>,</p>
      <p>The seller has reserved <strong>"${listing.title}"</strong> for you. Coordinate your meetup directly and complete the transaction!</p>
      <a href="${link}" class="btn">View Item</a>
      <hr class="divider"/>
      <p style="font-size:13px; color:#8e8e93;">Once you've exchanged the item in person, both of you need to mark the transaction complete inside CampusKart.</p>
    `),
  });
}

// 8. Rental return reminder
async function sendRentalReminderEmail(renter, listing, dueDate) {
  const link = `${APP_URL}/my-activity.html`;
  return sendEmail({
    to: renter.email,
    subject: `⏰ Rental return reminder — "${listing.title}"`,
    html: baseTemplate(`
      <p>Hi <strong>${renter.firstName}</strong>,</p>
      <p>Just a friendly reminder that your rental of <strong>"${listing.title}"</strong> is due to be returned on <strong>${new Date(dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>.</p>
      <a href="${link}" class="btn">View My Activity</a>
      <p style="font-size:13px; color:#8e8e93;">Contact the lister to arrange a return. Once returned, mark the transaction complete from your activity page.</p>
    `),
  });
}

// 9. New message notification
async function sendNewMessageEmail(recipient, sender, listing) {
  const link = `${APP_URL}/messages.html?listing=${listing._id}&user=${sender._id}`;
  return sendEmail({
    to: recipient.email,
    subject: `💬 New message from ${sender.firstName} on CampusKart`,
    html: baseTemplate(`
      <p>Hi <strong>${recipient.firstName}</strong>,</p>
      <p><strong>${sender.firstName} ${sender.lastName}</strong> sent you a message about <strong>"${listing.title}"</strong>.</p>
      <a href="${link}" class="btn">Open Conversation</a>
      <p style="font-size:13px; color:#8e8e93;">Reply directly on CampusKart to keep your conversation safe and on record.</p>
    `),
  });
}

module.exports = {
  getAppUrl,
  APP_URL,
  sendVerificationEmail,
  sendMagicLinkEmail,
  sendPasswordResetEmail,
  sendListingApprovedEmail,
  sendListingRejectedEmail,
  sendInterestNotificationEmail,
  sendItemReservedEmail,
  sendRentalReminderEmail,
  sendNewMessageEmail,
};
