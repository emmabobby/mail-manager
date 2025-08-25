"use client"

import React from "react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Trash2, Mail, Plus, Send, ClipboardPaste, Link2, Code2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { LinkModal } from "@/components/link-modal"

export default function EmailManager() {
  const [emailCount, setEmailCount] = useState<number>(0)
  const [emailList, setEmailList] = useState<string[]>([])
  const [newEmail, setNewEmail] = useState("")
  const [bulkInput, setBulkInput] = useState("")         // NEW: bulk paste input
  const [emailSubject, setEmailSubject] = useState("")
  const [emailContent, setEmailContent] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const { toast } = useToast()

  // Simple email validator (good enough for product UI)
  const isValidEmail = (e: string) => /^\S+@\S+\.\S+$/.test(e)

  // Split by commas, semicolons, whitespace, or new lines
  const parseEmails = (text: string) => {
    return text
      .split(/[\s,;]+/)
      .map(e => e.trim().toLowerCase())
      .filter(Boolean)
  }

  const addEmail = () => {
    const candidate = newEmail.trim().toLowerCase()
    if (!candidate) return
    if (!isValidEmail(candidate)) {
      toast({
        title: "Invalid email",
        description: `"${candidate}" is not a valid email address.`,
        variant: "destructive",
      })
      return
    }
    if (emailList.includes(candidate)) {
      toast({
        title: "Duplicate",
        description: `"${candidate}" is already in the list.`,
      })
      return
    }
    const updated = [...emailList, candidate]
    setEmailList(updated)
    setEmailCount(updated.length)
    setNewEmail("")
  }

  // NEW: Add many at once from bulkInput (paste)
  const addEmailsFromText = (text: string) => {
    const parsed = parseEmails(text)
    if (parsed.length === 0) {
      toast({ title: "Nothing to add", description: "Paste emails separated by commas, spaces, or new lines." })
      return
    }

    const uniques = new Set(emailList)
    let added = 0
    let duplicates = 0
    let invalids = 0

    for (const e of parsed) {
      if (!isValidEmail(e)) {
        invalids++
        continue
      }
      if (uniques.has(e)) {
        duplicates++
        continue
      }
      uniques.add(e)
      added++
    }

    const updated = Array.from(uniques)
    setEmailList(updated)
    setEmailCount(updated.length)

    toast({
      title: added > 0 ? `Added ${added} email${added === 1 ? "" : "s"}` : "No new emails added",
      description: `${duplicates} duplicate${duplicates === 1 ? "" : "s"}, ${invalids} invalid.`,
    })

    setBulkInput("") // clear textarea after processing
  }

  // Optional: auto-add on paste (no extra click)
  const handleBulkPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // Delay to let the pasted content land in the textarea
    setTimeout(() => {
      addEmailsFromText((e.target as HTMLTextAreaElement).value)
    }, 0)
  }

  const removeEmail = (emailToRemove: string) => {
    const updatedList = emailList.filter((email) => email !== emailToRemove)
    setEmailList(updatedList)
    setEmailCount(updatedList.length)
  }

  const clearAllEmails = () => {
    setEmailList([])
    setEmailCount(0)
  }

  const sendEmails = async () => {
    if (emailList.length === 0) {
      toast({
        title: "No emails to send",
        description: "Please add some email addresses first.",
        variant: "destructive",
      })
      return
    }

    if (!emailSubject.trim()) {
      toast({
        title: "Missing subject",
        description: "Please enter an email subject.",
        variant: "destructive",
      })
      return
    }

    let finalContent = emailContent.trim()

    // If content doesn't look like HTML, wrap it in paragraphs
    if (!/<[a-z][\s\S]*>/i.test(finalContent)) {
      finalContent = finalContent
        .split('\n')
        .map(line => line.trim() ? `<p>${line}</p>` : '<p>&nbsp;</p>')
        .join('')
    }

    setIsLoading(true)

    try {
      const response = await fetch('/api/send-emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emails: emailList,
          subject: emailSubject,
          htmlContent: finalContent,
          sender: {
            name: "John",  // Replace with actual sender name
            email: "michaeleustace638@gmail.com"
          }
        }),
      });

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || 'Failed to send emails')
      }

      if (data.summary?.failed > 0) {
        toast({
          title: "Partial success",
          description: `Successfully sent ${data.summary.success} out of ${emailList.length} emails. ${data.summary.failed} failed.`,
        })
      } else {
        toast({
          title: "Emails sent successfully!",
          description: `Successfully sent ${data.summary?.success ?? emailList.length} emails.`,
        })
      }

      clearAllEmails()
    } catch (error) {
      console.error('Error sending emails:', error)
      toast({
        title: "Failed to send emails",
        description: error instanceof Error ? error.message : "There was an error sending your emails. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      addEmail()
    }
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Email Manager</h1>
          <p className="text-muted-foreground">Manage and send emails</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Email Campaign
            </CardTitle>
            <CardDescription>Add email addresses and send your campaign</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Email Count Display */}
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <span className="text-sm font-medium">Total Emails:</span>
              <Badge variant="secondary" className="text-lg px-3 py-1">
                {emailCount}
              </Badge>
            </div>

            {/* Single Add (kept) */}
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="Enter a single email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyPress={handleKeyPress}
                className="flex-1"
              />
              <Button onClick={addEmail} size="icon" title="Add single email">
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {/* NEW: Bulk Paste */}
            <div className="space-y-2">
              <label htmlFor="bulk-emails" className="text-sm font-medium">
                Bulk paste (comma, space, or new line)
              </label>
              <textarea
                id="bulk-emails"
                className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder={`e.g.
jane@example.com
john@example.com, team@company.com more@company.com`}
                value={bulkInput}
                onChange={(e) => setBulkInput(e.target.value)}
                onPaste={handleBulkPaste} // auto-add on paste
              />
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={() => addEmailsFromText(bulkInput)}>
                  <ClipboardPaste className="h-4 w-4 mr-2" />
                  Add all
                </Button>
                <span className="text-xs text-muted-foreground">
                  We’ll remove duplicates and ignore invalid emails.
                </span>
              </div>
            </div>

            {/* Email List */}
            {emailList.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Email List</h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearAllEmails}
                    className="text-destructive hover:text-destructive bg-transparent"
                  >
                    Clear All
                  </Button>
                </div>
                <div className="max-h-60 overflow-y-auto space-y-2 p-3 border rounded-lg">
                  {emailList.map((email, index) => (
                    <div key={index} className="flex items-center justify-between p-2 bg-muted rounded">
                      <span className="text-sm">{email}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeEmail(email)}
                        className="text-destructive hover:text-destructive h-8 w-8 p-0"
                        title="Remove"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Email Subject */}
            <div className="space-y-2">
              <label htmlFor="email-subject" className="text-sm font-medium">
                Subject
              </label>
              <Input
                id="email-subject"
                placeholder="Enter email subject"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                disabled={isLoading}
              />
            </div>

            {/* Email Content */}
            <div className="space-y-2">
              <div className="grid gap-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="email-content">Email Content</Label>
                </div>
                <div className="relative">
                  <textarea
                    ref={textareaRef}
                    id="email-content"
                    className="min-h-[200px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    value={emailContent}
                    onChange={(e) => setEmailContent(e.target.value)}
                    placeholder="Enter your email content here..."
                    disabled={isLoading}
                  />
                  <div className="absolute right-2 top-2 flex space-x-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => {
                        const plainText = emailContent;
                        const paragraphs = plainText
                          .split('\n\n')
                          .filter(p => p.trim() !== '');

                        let htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Template</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333333;
      margin: 0;
      padding: 20px;
      background-color: #f8f9fa;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: #ffffff;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.1);
    }
    h1 {
      color: #007BFF;
      font-size: 20px;
    }
    p {
      font-size: 15px;
      margin: 10px 0;
    }
    .button {
      display: inline-block;
      background-color: #007BFF;
      color: #ffffff !important;
      padding: 12px 24px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: bold;
      margin-top: 20px;
    }
    .footer {
      margin-top: 30px;
      font-size: 12px;
      color: #666666;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Dear {{recipientName}},</h1>
`;

                        // Convert paragraphs to HTML
                        paragraphs.forEach(para => {
                          // Check if paragraph contains a URL
                          const urlMatch = para.match(/\b(https?:\/\/[^\s]+)\b/);

                          if (urlMatch) {
                            const url = urlMatch[0];
                            const text = para.replace(url, '').trim() || 'Click here';
                            htmlContent += `    <p style="text-align: center;">
      <a href="${url}" class="button" target="_blank">
        ${text}
      </a>
    </p>\n`;
                          } else {
                            // Regular paragraph
                            htmlContent += `    <p>${para.replace(/\n/g, '<br>')}</p>\n`;
                          }
                        });

                        // Add closing tags
                        htmlContent += `   
    <div class="footer">
      © ${new Date().getFullYear()} .
    </div>
  </div>
</body>
</html>`;

                        setEmailContent(htmlContent);

                        toast({
                          title: "Template Generated",
                          description: "Plain text has been converted to an HTML email template.",
                        });
                      }}
                      title="Convert to HTML Template"
                    >
                      <Code2 className="h-4 w-4" />
                    </Button>
                    <LinkModal
                      onInsert={(text, url) => {
                        const cursorPos = textareaRef.current?.selectionStart || 0;
                        const before = emailContent.substring(0, cursorPos);
                        const after = emailContent.substring(cursorPos);
                        const newContent = `${before}<a href="${url}" style="color: #2563eb; text-decoration: underline;">${text}</a>${after}`;
                        setEmailContent(newContent);

                        // Set cursor position after the inserted link
                        setTimeout(() => {
                          if (textareaRef.current) {
                            const newCursorPos = cursorPos + text.length + 15 + url.length;
                            textareaRef.current.focus();
                            textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
                          }
                        }, 0);
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Send Button */}
            <Button
              onClick={sendEmails}
              disabled={isLoading || emailList.length === 0 || !emailSubject.trim() || !emailContent.trim()}
              className="w-full"
              size="lg"
            >
              {isLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send {emailCount} Email{emailCount !== 1 ? "s" : ""}
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Instructions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">How to use</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>1. Paste many emails at once into the Bulk paste box (comma, space, or new line).</p>
            <p>2. Click <strong>Add all</strong> or just paste—auto-add will trigger on paste.</p>
            <p>3. Review the list; remove any you don’t want.</p>
            <p>4. Enter subject and HTML content, then click <strong>Send</strong>.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
