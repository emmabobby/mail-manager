"use client"

import { useState } from "react"
import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog"
import { Input } from "./ui/input"
import { Label } from "./ui/label"

export function LinkModal({ onInsert }: { onInsert: (text: string, url: string) => void }) {
  const [open, setOpen] = useState(false)
  const [linkText, setLinkText] = useState("")
  const [linkUrl, setLinkUrl] = useState("")
  const isFormValid = linkText.trim() !== "" && linkUrl.trim() !== ""

  // If no scheme is present, default to https://
  const normalizeUrl = (url: string) => {
    const trimmed = url.trim()
    if (!trimmed) return trimmed
    // If it already has a scheme like http:, https:, mailto:, etc., keep as-is
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed
    // Protocol-relative URLs like //example.com -> keep as-is (rare in emails but supported)
    if (trimmed.startsWith("//")) return trimmed
    return `https://${trimmed}`
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isFormValid) {
      onInsert(linkText, normalizeUrl(linkUrl))
      setLinkText("")
      setLinkUrl("")
      setOpen(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="icon">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <span className="sr-only">Insert Link</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Insert Link</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="link-text">Link Text</Label>
            <Input
              id="link-text"
              value={linkText}
              onChange={(e) => setLinkText(e.target.value)}
              placeholder="Link text"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="link-url">Link URL</Label>
            <Input
              id="link-url"
              type="text"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="example.com or https://example.com"
              required
            />
            {/* <p className="text-xs text-muted-foreground">Must start with http:// or https://</p> */}
          </div>
          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isFormValid}>
              Insert Link
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
