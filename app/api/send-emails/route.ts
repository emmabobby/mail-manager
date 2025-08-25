import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

type EmailPayload = {
  emails: string[];
  subject: string;
  htmlContent: string;
  sender: {
    name: string;
    email: string;
  };
};

export async function POST(request: Request) {
  // Initialize nodemailer transporter
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  try {
    const { emails, subject, htmlContent, sender } = await request.json() as EmailPayload;

    // Validate required fields
    if (!emails?.length) {
      return NextResponse.json(
        { success: false, message: 'No email addresses provided' },
        { status: 400 }
      );
    }

    if (!subject?.trim()) {
      return NextResponse.json(
        { success: false, message: 'Email subject is required' },
        { status: 400 }
      );
    }

    if (!htmlContent?.trim()) {
      return NextResponse.json(
        { success: false, message: 'Email content is required' },
        { status: 400 }
      );
    }

    if (!sender?.email || !sender?.name) {
      return NextResponse.json(
        { success: false, message: 'Sender information is required' },
        { status: 400 }
      );
    }

    // Process emails in batches with delays
    const BATCH_SIZE = 15; // Number of emails to send in parallel
    const BATCH_DELAY_MS = 1000; // 1 second delay between batches
    
    const results = [];
    let successCount = 0;
    let failCount = 0;

    // Helper function to process a single batch of emails
    const processBatch = async (batch: string[]) => {
      const batchPromises = batch.map(email => 
        sendEmail(email).catch(error => ({
          email,
          status: 'failed' as const,
          error: error instanceof Error ? error.message : 'Unknown error'
        }))
      );
      return Promise.all(batchPromises);
    };

    // Function to send a single email
    const sendEmail = async (email: string) => {
      const formattedHtml = formatHtmlContent(htmlContent, subject);
      
      await transporter.sendMail({
        from: `"${sender.name}" <${sender.email}>`,
        to: email,
        subject: subject,
        html: formattedHtml,
        text: htmlContent.replace(/<[^>]*>?/gm, ''),
      });
      
      return { email, status: 'success' as const };
    };

    // Format HTML content with a wrapper if it's not already a complete HTML document
    const formatHtmlContent = (content: string, subject: string) => {
      const trimmedContent = content.trim();
      if (trimmedContent.toLowerCase().startsWith('<!doctype html>')) {
        return trimmedContent;
      }
      
      return `<!DOCTYPE html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${subject}</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        line-height: 1.6;
        color: #333333;
        margin: 0;
        padding: 20px;
        background-color: #f8f9fa;
      }
      .content {
        max-width: 600px;
        margin: 0 auto;
        background: #ffffff;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }
    </style>
  </head>
  <body>
    <div class="content">
      ${trimmedContent}
    </div>
  </body>
</html>`;
    };

    // Process emails in batches
    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);
      const batchResults = await processBatch(batch);
      
      // Update counts and results
      for (const result of batchResults) {
        if (result.status === 'success') {
          successCount++;
        } else {
          failCount++;
          console.error(`Failed to send to ${result.email}:`, result.error);
        }
        results.push(result);
      }
      
      // Add delay between batches (except after the last batch)
      if (i + BATCH_SIZE < emails.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    // Return success response
    return NextResponse.json({
      success: true,
      message: `Processed ${emails.length} email(s)`,
      summary: {
        total: emails.length,
        success: successCount,
        failed: failCount,
      },
      results,
    });

  } catch (error) {
    console.error('Error processing email request:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to process email sending request',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
