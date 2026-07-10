// =============================================
// Email Sending Utility — Nodemailer
// =============================================

import nodemailer from 'nodemailer';
import { env } from '../config/env';
import logger from '../config/logger';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) {
    return transporter;
  }

  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
    logger.warn('⚠️ SMTP credentials not configured. Email sending disabled.');
    return null;
  }

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT || 587,
    secure: env.SMTP_PORT === 465,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });

  return transporter;
}

/**
 * Send an email. Fails silently in development to avoid
 * blocking the request flow.
 */
export async function sendEmail(options: EmailOptions): Promise<boolean> {
  const transport = getTransporter();

  if (!transport) {
    logger.debug(`[Email Skipped] To: ${options.to}, Subject: ${options.subject}`);
    return false;
  }

  try {
    await transport.sendMail({
      from: env.EMAIL_FROM || '"ShopVerse" <noreply@shopverse.com>',
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    logger.info(`📧 Email sent to ${options.to}: ${options.subject}`);
    return true;
  } catch (error) {
    logger.error('Failed to send email:', error);
    return false;
  }
}
