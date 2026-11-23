import nodemailer from 'nodemailer';

export interface EmailServiceStatus {
  configured: boolean;
  provider: 'resend' | 'smtp' | 'none';
  fromAddress: string | null;
  resendConfigured?: boolean;
  smtpConfigured?: boolean;
  smtpHost?: string | null;
  smtpPort?: number | null;
  configWarning?: string | null;
}

export interface SendEmailResult {
  sent: boolean;
  provider: 'resend' | 'smtp' | 'none';
  reason?: string;
  messageId?: string;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getEmailServiceStatus(): EmailServiceStatus {
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const smtpHost = process.env.SMTP_HOST?.trim();
  const smtpPortRaw = process.env.SMTP_PORT?.trim();
  const smtpPort = smtpPortRaw ? Number(smtpPortRaw) : 587;
  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPass = process.env.SMTP_PASS?.replace(/\s+/g, '');
  const configuredFrom = process.env.EMAIL_FROM?.trim() || smtpUser || null;

  const resendConfigured = Boolean(resendKey);
  const smtpConfigured = Boolean(smtpHost && smtpUser && smtpPass);

  let configWarning: string | null = null;
  if (resendConfigured && smtpConfigured) {
    configWarning =
      'Both RESEND_API_KEY and SMTP_* are set; Resend is currently used first. Delete RESEND_API_KEY in Secrets to use Gmail SMTP.';
  } else if (smtpConfigured) {
    if (!smtpHost || smtpHost.includes('@') || smtpHost.includes('<') || /\s/.test(smtpHost)) {
      configWarning = 'SMTP_HOST looks invalid (for Gmail it must be smtp.gmail.com).';
    } else if (smtpPortRaw && (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535)) {
      configWarning = 'SMTP_PORT must be a valid port number (465 or 587 for Gmail).';
    } else if (smtpUser && !smtpUser.includes('@')) {
      configWarning = 'SMTP_USER should be your full email address (e.g. yourname@gmail.com).';
    }
  } else if (smtpHost || smtpUser || smtpPass) {
    configWarning = 'Incomplete SMTP settings: SMTP_HOST, SMTP_USER, and SMTP_PASS are all required.';
  }

  if (resendKey) {
    return {
      configured: true,
      provider: 'resend',
      fromAddress: configuredFrom || 'WebManager Pro <onboarding@resend.dev>',
      resendConfigured,
      smtpConfigured,
      smtpHost: smtpHost || null,
      smtpPort: Number.isFinite(smtpPort) ? smtpPort : null,
      configWarning,
    };
  }
  if (smtpHost && smtpUser && smtpPass) {
    return {
      configured: true,
      provider: 'smtp',
      fromAddress: configuredFrom || smtpUser,
      resendConfigured,
      smtpConfigured,
      smtpHost,
      smtpPort: Number.isFinite(smtpPort) ? smtpPort : 587,
      configWarning,
    };
  }
  return {
    configured: false,
    provider: 'none',
    fromAddress: null,
    resendConfigured,
    smtpConfigured,
    smtpHost: smtpHost || null,
    smtpPort: Number.isFinite(smtpPort) ? smtpPort : null,
    configWarning,
  };
}

export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<SendEmailResult> {
  const status = getEmailServiceStatus();
  if (!status.configured || !status.fromAddress) {
    return {
      sent: false,
      provider: 'none',
      reason: status.configWarning || 'Email delivery is not configured (set RESEND_API_KEY or SMTP_* secrets).',
    };
  }

  try {
    if (status.provider === 'resend') {
      const apiKey = process.env.RESEND_API_KEY!.trim();
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: status.fromAddress,
          to: [params.to],
          subject: params.subject,
          text: params.text,
          html: params.html,
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        return {
          sent: false,
          provider: 'resend',
          reason: `Resend rejected message (${resp.status}): ${errText.slice(0, 220)}`,
        };
      }
      const data = (await resp.json().catch(() => ({}))) as { id?: string };
      return { sent: true, provider: 'resend', messageId: data.id };
    }

    if (status.configWarning && !status.resendConfigured) {
      return {
        sent: false,
        provider: 'smtp',
        reason: status.configWarning,
      };
    }

    const port = Number((process.env.SMTP_PORT || '587').trim()) || 587;
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST!.trim(),
      port,
      secure: port === 465,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      auth: {
        user: process.env.SMTP_USER!.trim(),
        pass: process.env.SMTP_PASS!.replace(/\s+/g, ''),
      },
    });

    const info = await transporter.sendMail({
      from: status.fromAddress,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
    });
    return { sent: true, provider: 'smtp', messageId: info.messageId };
  } catch (error) {
    return {
      sent: false,
      provider: status.provider,
      reason: error instanceof Error ? error.message : 'Email dispatch failed',
    };
  }
}

export function buildInviteEmailPayload(params: {
  recipientName: string;
  organizationName: string;
  roleLabel: string;
  inviteUrl: string;
  websiteName?: string | null;
}) {
  const safeName = escapeHtml(params.recipientName);
  const safeOrg = escapeHtml(params.organizationName);
  const safeRole = escapeHtml(params.roleLabel);
  const safeUrl = escapeHtml(params.inviteUrl);
  const websiteClause = params.websiteName
    ? ` for <strong>${escapeHtml(params.websiteName)}</strong>`
    : '';
  const websiteTextClause = params.websiteName ? ` for ${params.websiteName}` : '';

  return {
    subject: `${params.organizationName}: Your Portal Invitation`,
    text: `Hello ${params.recipientName},\n\nYou have been invited by ${params.organizationName} as ${params.roleLabel}${websiteTextClause}.\n\nActivate your account here (expires in 7 days):\n${params.inviteUrl}\n`,
    html:
      `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">` +
      `<p style="font-size:12px;color:#1d4ed8;font-weight:600;margin:0 0 8px">${safeOrg}</p>` +
      `<h2 style="font-size:20px;margin:0 0 12px">You're invited to the portal</h2>` +
      `<p style="font-size:14px;line-height:1.6;color:#334155">Hello ${safeName}, you have been invited as <strong>${safeRole}</strong>${websiteClause}.</p>` +
      `<p style="margin:20px 0"><a href="${safeUrl}" style="display:inline-block;padding:12px 20px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">Accept Invitation &amp; Set Password</a></p>` +
      `<p style="font-size:12px;color:#64748b">This link expires in 7 days. If the button does not open, copy this URL:<br/>${safeUrl}</p>` +
      `</div>`,
  };
}
