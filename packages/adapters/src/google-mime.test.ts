import { describe, expect, it } from "vitest";
import { buildMimeMessage, formatAddress, htmlToText, readGmailPayload } from "./google-mime.js";

function encoded(text: string) {
  return Buffer.from(text, "utf8").toString("base64url");
}

describe("google mime", () => {
  it("formats addresses and rejects malformed ones", () => {
    expect(formatAddress("bob@example.test")).toBe("bob@example.test");
    expect(formatAddress("Bob Smith <bob@example.test>")).toBe('"Bob Smith" <bob@example.test>');
    expect(formatAddress("Zoë <zoe@example.test>")).toBe(
      `=?UTF-8?B?${Buffer.from("Zoë").toString("base64")}?= <zoe@example.test>`,
    );
    expect(() => formatAddress("not-an-address")).toThrow("Invalid email address");
  });

  it("refuses header injection through the subject or recipients", () => {
    expect(() =>
      buildMimeMessage({
        to: ["a@example.test"],
        subject: "Hi\r\nBcc: evil@example.test",
        text: "x",
      }),
    ).toThrow("single line");
    expect(() =>
      buildMimeMessage({
        to: ["a@example.test\nBcc: evil@example.test"],
        subject: "Hi",
        text: "x",
      }),
    ).toThrow("single line");
  });

  it("encodes a non-ASCII subject and base64s the body", () => {
    const raw = buildMimeMessage({
      to: ["a@example.test"],
      cc: ["c@example.test"],
      subject: "Résumé",
      text: "Grüße",
      inReplyTo: "<m1@example.test>",
      references: "<m0@example.test> <m1@example.test>",
    });
    expect(raw).toContain("To: a@example.test");
    expect(raw).toContain("Cc: c@example.test");
    expect(raw).toContain(`Subject: =?UTF-8?B?${Buffer.from("Résumé").toString("base64")}?=`);
    expect(raw).toContain("In-Reply-To: <m1@example.test>");
    expect(raw).toContain(Buffer.from("Grüße").toString("base64"));
    expect(raw).not.toContain("Grüße");
  });

  it("builds multipart messages with HTML and attachments", () => {
    const raw = buildMimeMessage({
      to: ["a@example.test"],
      subject: "Report",
      text: "See attached",
      html: "<p>See attached</p>",
      attachments: [
        { filename: "q3.csv", mimeType: "text/csv", content: new TextEncoder().encode("a,b") },
      ],
    });
    expect(raw).toMatch(/Content-Type: multipart\/mixed; boundary="savingroup_[0-9a-f]+"/);
    expect(raw).toMatch(/Content-Type: multipart\/alternative; boundary="savingroup_[0-9a-f]+"/);
    expect(raw).toContain('Content-Disposition: attachment; filename="q3.csv"');
    expect(raw).toContain(Buffer.from("a,b").toString("base64"));
  });

  it("requires a recipient", () => {
    expect(() => buildMimeMessage({ to: [], subject: "x", text: "y" })).toThrow("recipient");
  });

  it("prefers plain text, falls back to readable HTML, and lists attachments", () => {
    const plain = readGmailPayload({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/html", body: { data: encoded("<p>Hello <b>there</b></p>") } },
        { mimeType: "text/plain", body: { data: encoded("Hello there") } },
        {
          mimeType: "application/pdf",
          filename: "invoice.pdf",
          body: { attachmentId: "att-1", size: 2048 },
        },
      ],
    });
    expect(plain).toEqual({
      text: "Hello there",
      attachments: [
        {
          attachment_id: "att-1",
          filename: "invoice.pdf",
          mime_type: "application/pdf",
          size: 2048,
        },
      ],
    });
    const html = readGmailPayload({
      mimeType: "text/html",
      headers: [{ name: "Content-Type", value: 'text/html; charset="iso-8859-1"' }],
      body: { data: Buffer.from("<div>Caf\xe9</div>", "latin1").toString("base64url") },
    });
    expect(html.text).toBe("Café");
  });

  it("turns HTML into text without scripts, styles, or tracking markup", () => {
    expect(
      htmlToText(
        '<style>p{}</style><script>steal()</script><p>Hi&nbsp;Bob</p><a href="https://x.test">site</a><br>Bye<!-- hidden -->',
      ),
    ).toBe("Hi Bob\nsite (https://x.test)\nBye");
  });
});
