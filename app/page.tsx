"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Trash2, Mail, Plus, Send } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

export default function EmailManager() {
  const [emailCount, setEmailCount] = useState<number>(0)
  const [emailList, setEmailList] = useState<string[]>([])
  const [newEmail, setNewEmail] = useState("")
  const [emailSubject, setEmailSubject] = useState("")
  const [emailContent, setEmailContent] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()

  const addEmail = () => {
    if (newEmail.trim() && !emailList.includes(newEmail.trim())) {
      setEmailList([...emailList, newEmail.trim()])
      setNewEmail("")
      setEmailCount(emailList.length + 1)
    }
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

    if (!emailContent.trim()) {
      toast({
        title: "Missing content",
        description: "Please enter the email content.",
        variant: "destructive",
      })
      return
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
          htmlContent: emailContent,
          sender: {
            name: "John",
            email: "jghatti396@gmail.com"
          }
        }),
      })

      const data = await response.json()

      if (data.summary.success === 0) {
        throw new Error(data.results[0]?.error || 'Failed to send emails')
      }

      if (data.summary.failed > 0) {
        toast({
          title: "Partial success",
          description: `Successfully sent ${data.summary.success} out of ${emailList.length} emails. ${data.summary.failed} failed.`,
          variant: "default",
        })
      } else {
        toast({
          title: "Emails sent successfully!",
          description: `Successfully sent ${data.summary.success} emails.`,
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
          <p className="text-muted-foreground">Manage and send emails </p>
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

            {/* Add Email Input */}
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="Enter email address"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyPress={handleKeyPress}
                className="flex-1"
              />
              <Button onClick={addEmail} size="icon">
                <Plus className="h-4 w-4" />
              </Button>
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
              <label htmlFor="email-content" className="text-sm font-medium">
                Email Content (HTML)
              </label>
              <textarea
                id="email-content"
                className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="<p>Your email content here...</p>"
                value={emailContent}
                onChange={(e) => setEmailContent(e.target.value)}
                disabled={isLoading}
              />
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
            <p>1. Enter email addresses one by one and click the + button</p>
            <p>2. Review your email list and remove any unwanted addresses</p>
            <p>3. Click "Send" to send emails </p>
            <p>4. After sending, you can clear the list and add new accounts</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
