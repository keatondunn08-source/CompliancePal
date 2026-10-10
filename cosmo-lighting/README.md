# Cosmo Lighting Kensington: agreement and invoice

| File | What it is |
|---|---|
| `Cosmo-Lighting-Website-Agreement.docx` / `.pdf` | Website Services Agreement: Signature Website Package plus add-ons, the optional Care Plan, and signatures |
| `Cosmo-Lighting-Invoice-INV-CLK-001.docx` / `.pdf` | Invoice for $1,900.00. The 50% deposit ($950.00) is due 7 days after issue. |
| `build/config.json` | Every name, price, date and placeholder in both documents |
| `build/build-docs.js` | Generates both `.docx` files from the config |

**Don't send these yet.** Anything still to fill in is highlighted yellow in `[CAPS]`.

## Must fill before sending

Provider: One Way Web Designs, Keaton Dunn (sole trader), keaton.dunn@outlook.com, 0434 955 607, onewaywebdesign.com.

- [ ] **ABN.** It isn't findable by web search, and this sandbox can't reach abr.business.gov.au.
- [ ] **Bank details:** account name, BSB and account number.
- [ ] **GST status.** The config says `"gst": "none"`, and the note is flagged `[CONFIRM GST STATUS]` until `"gstConfirmed": true`. If you're registered, set `"gst"` to `"exclusive"` (adds 10%, so $2,090) or `"inclusive"` (GST comes out of the $1,900). The title then becomes TAX INVOICE.
- [ ] **Business name registration.** Your ABN is in your own name, so "One Way Web Designs" must be a registered business name (ASIC) linked to that ABN. Check that the spelling matches the registration exactly. Your website reads "onewaywebdesign" (singular).

## Confirm with Effie

- [ ] **Legal entity:** *Cosmo Lighting (On the Parade) Pty Limited*, ABN 37 147 999 184. This is active on the ABR at postcode 2033, and the store is listed as "Cosmo Lighting on the Parade". There is also *Cosmo Lighting Design & Electrical Pty Ltd* (ABN 13 638 655 713) at 2033. Ask her which entity pays.
- [ ] **Her surname:** "Santini" comes from her website's structured data. It isn't verified.
- [ ] **Address:** 91–93 Anzac Parade, Kensington NSW 2033. Yelp says 105.
- [ ] **Suppliers:** a search result titles her current site "Lighting Outlet Kensington". Check that Lighting Outlet is a supplier and not her own trading name.
- [ ] **Founding year:** she said 1986, which is 40 years. Her current site says "nearly 35 years". Fix this before any of it goes on the new site.

## Decisions made in the documents (change in config if wrong)

| Item | Default used | Why |
|---|---|---|
| Postcode Shipping Calculator | **Included ($0)** | The notes gave no price for it |
| "Freight cost" | Built into the Supplier Sync Agent's pricing rules | The notes gave no price for it either |
| Signature scope | Premium design (unlimited pages, copywriting, 4K hero video, photo enhancement), Shopify payments for the life of the site, SEO/AEO/GEO, contact forms, AI assistant, 90 days' support | Keaton's list plus what onewaywebdesign.com advertises for Signature |
| Photo enhancement | Store, team and featured product photos. Supplier catalogue images are used as supplied | An uncapped catalogue would be unbounded work |
| Hosting | Included, no monthly fee, no time limit | Matches the "no monthly fee" promise on onewaywebdesign.com |
| Lighthouse 100 guarantee | **Left out** | Hard to hit with a 4K hero video plus a Shopify catalogue |
| Payment | 50% deposit within 7 days, 50% before go-live | The site is already built, so the balance is held until launch |
| Care Plan | $50/month or $500/year, opt-in tick box, not on the invoice | Your brief: very optional, no hosting |
| Governing law | Victoria | Your home state |
| Offer validity | 30 days (9 November 2026) | |

## Regenerate after editing `build/config.json`

```bash
NODE_PATH=$(npm root -g) node cosmo-lighting/build/build-docs.js
cd cosmo-lighting && soffice --headless --convert-to pdf *.docx
```
