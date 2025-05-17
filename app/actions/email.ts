'use server';

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendRedeemCodesEmail(email: string, codes: string[], plan: 'pro' | 'pro_plus') {
  try {
    const { data, error } = await resend.emails.send({
      from: 'Xognito <noreply@xognito.com>',
      to: email,
      subject: 'Your Xognito Pro Plan Redeem Codes',
      html: `
        <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #4F46E5; font-size: 24px; margin-bottom: 10px;">Your Xognito Pro Plan Codes</h1>
            <p style="color: #6B7280; font-size: 16px;">Here are your redeem codes for the ${plan === 'pro' ? 'Pro' : 'Pro Plus'} plan</p>
          </div>
          
          <div style="background: #F9FAFB; padding: 24px; border-radius: 12px; margin: 20px 0;">
            ${codes.map(code => `
              <div style="background: white; padding: 16px; margin: 12px 0; border-radius: 8px; font-family: ui-monospace, monospace; font-size: 20px; text-align: center; letter-spacing: 1px; border: 1px solid #E5E7EB;">
                ${code}
              </div>
            `).join('')}
          </div>

          <div style="background: #EEF2FF; padding: 20px; border-radius: 8px; margin: 24px 0;">
            <h2 style="color: #4F46E5; font-size: 18px; margin-bottom: 12px;">How to Redeem Your Code</h2>
            <ol style="color: #374151; margin: 0; padding-left: 20px;">
              <li style="margin-bottom: 8px;">Go to your Xognito dashboard</li>
              <li style="margin-bottom: 8px;">Click on Settings</li>
              <li style="margin-bottom: 8px;">Go to the Billing tab</li>
              <li style="margin-bottom: 8px;">Enter your code in the "Redeem Code" section</li>
            </ol>
          </div>

          <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #E5E7EB;">
            <p style="color: #6B7280; font-size: 14px; margin: 0;">
              Each code is valid for 30 days and can only be used once.
            </p>
            <p style="color: #6B7280; font-size: 14px; margin-top: 8px;">
              If you didn't request these codes, please ignore this email.
            </p>
          </div>
        </div>
      `,
    });

    if (error) {
      console.error('Error sending email:', error);
      throw error;
    }

    return { success: true, data };
  } catch (error) {
    console.error('Error in sendRedeemCodesEmail:', error);
    throw error;
  }
} 