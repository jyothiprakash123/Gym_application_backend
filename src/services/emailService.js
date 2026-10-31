const nodemailer = require("nodemailer");

/**
 * FitZone Email & SMTP Service
 * Supports standard SMTP (Gmail, Outlook, SendGrid, Amazon SES, Mailgun, custom SMTP)
 * with a resilient development fallback if SMTP credentials are not yet set in .env.
 */
class EmailService {
  constructor() {
    this.transporter = null;
    this.isLive = false;
    this.initTransporter();
  }

  initTransporter() {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const port = parseInt(process.env.SMTP_PORT, 10) || 587;
    const secure = process.env.SMTP_SECURE === "true" || port === 465;

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: {
          user,
          pass,
        },
      });
      this.isLive = true;
      console.log(`[EmailService] Configured live SMTP transport with host: ${host}:${port}`);
    } else {
      // Development simulated SMTP fallback
      this.transporter = nodemailer.createTransport({
        jsonTransport: true,
      });
      this.isLive = false;
      console.log("[EmailService] No live SMTP credentials found in .env. Running in simulated SMTP mode (emails logged and recorded).");
    }
  }

  /**
   * Generates a modern branded HTML email template for gym notices
   */
  generateEmailHtml({ title, content, category, priority, gymName, branchName, memberName }) {
    const priorityColor = priority === "Urgent" ? "#e11d48" : priority === "High" ? "#d97706" : "#2563eb";
    const categoryBg = category === "Closure / Holiday" ? "#fef2f2" : "#eff6ff";
    const categoryColor = category === "Closure / Holiday" ? "#b91c1c" : "#1d4ed8";

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
        <div style="max-width: 600px; margin: 30px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
          
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); padding: 28px 24px; text-align: center;">
            <div style="font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px; margin-bottom: 4px;">
              FitZone Gyms
            </div>
            <div style="font-size: 13px; color: #bfdbfe; font-weight: 500;">
              ${gymName || "FitZone Fitness Club"} • ${branchName || "All Branches (Common Notice)"}
            </div>
          </div>

          <!-- Notice Content -->
          <div style="padding: 32px 28px;">
            <div style="display: flex; gap: 8px; margin-bottom: 16px;">
              <span style="display: inline-block; padding: 4px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; border-radius: 6px; background-color: ${categoryBg}; color: ${categoryColor};">
                ${category || "Notice"}
              </span>
              <span style="display: inline-block; padding: 4px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; border-radius: 6px; background-color: #f1f5f9; color: ${priorityColor}; margin-left: 6px;">
                Priority: ${priority || "Normal"}
              </span>
            </div>

            ${memberName ? `<p style="font-size: 14px; color: #64748b; margin-top: 0; margin-bottom: 12px;">Dear <strong>${memberName}</strong>,</p>` : ""}

            <h1 style="font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 16px; line-height: 1.3;">
              ${title}
            </h1>

            <div style="background-color: #f8fafc; border-left: 4px solid #2563eb; padding: 18px 20px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
              <p style="font-size: 14.5px; line-height: 1.6; color: #334155; margin: 0; white-space: pre-line;">
                ${content}
              </p>
            </div>

            <p style="font-size: 13px; color: #64748b; margin-bottom: 0; line-height: 1.5;">
              If you have any questions or require assistance regarding this notice, please feel free to reach out to the front desk team at your branch.
            </p>
          </div>

          <!-- Footer -->
          <div style="background-color: #f1f5f9; padding: 18px 24px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8;">
            <p style="margin: 0 0 4px 0;">This is an automated announcement sent to active members of FitZone Gyms.</p>
            <p style="margin: 0;">© ${new Date().getFullYear()} FitZone Gyms SaaS. All rights reserved.</p>
          </div>

        </div>
      </body>
      </html>
    `;
  }

  /**
   * Broadcast an email message to multiple recipients via SMTP
   */
  async sendBroadcastEmail({
    recipients, // Array of { name, email, id }
    title,
    content,
    category,
    priority,
    gymName,
    branchName,
    fromEmail,
  }) {
    if (!recipients || recipients.length === 0) {
      return { success: false, message: "No recipients provided" };
    }

    // Ensure live transporter is initialized if credentials exist
    if (!this.isLive && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      this.initTransporter();
    }

    const sender =
      fromEmail ||
      process.env.SMTP_FROM ||
      (process.env.MAIL_FROM_EMAIL
        ? `"${process.env.MAIL_FROM_NAME || "FitZone Gyms"}" <${process.env.MAIL_FROM_EMAIL}>`
        : null) ||
      (process.env.SMTP_USER
        ? `"${process.env.MAIL_FROM_NAME || "FitZone Gyms"}" <${process.env.SMTP_USER}>`
        : null) ||
      '"FitZone Gyms" <notifications@fitzone.com>';
    const emailSubject = `[FitZone Notice] ${title}`;

    let sentCount = 0;
    const errors = [];

    // Send emails (batch / sequential to prevent rate-limiting)
    for (const recipient of recipients) {
      if (!recipient.email) continue;

      const html = this.generateEmailHtml({
        title,
        content,
        category,
        priority,
        gymName,
        branchName,
        memberName: recipient.name,
      });

      const mailOptions = {
        from: sender,
        to: `"${recipient.name || "Member"}" <${recipient.email}>`,
        subject: emailSubject,
        text: `${title}\n\n${content}\n\nFitZone Gyms Notice`,
        html,
      };

      try {
        const info = await this.transporter.sendMail(mailOptions);
        console.log(`[SMTP] Sent notice "${title}" to ${recipient.email}. MessageId: ${info.messageId || "simulated"}`);
        sentCount++;
      } catch (err) {
        console.error(`[SMTP Error] Failed to send email to ${recipient.email}:`, err.message);
        errors.push({ email: recipient.email, error: err.message });
      }
    }

    return {
      success: true,
      sentCount,
      totalRecipients: recipients.length,
      errors: errors.length > 0 ? errors : null,
    };
  }
}

module.exports = new EmailService();
