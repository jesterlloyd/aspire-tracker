// src/lib/studio/studioLayouts.js
//
// STUDIO-1: the starting layouts on the Studio home. Each is an ordinary design (blocks JSON), so a
// layout is never special once opened: it is a draft like any other. The words are placeholders
// written to be replaced; a button starts with NO link, which blocks the send until one is added.

import { makeBlock, sanitizeDesign } from './studioBlocks.js'

const b = (type, props = {}, style = {}) => makeBlock(type, { props, style })

export const LAYOUTS = Object.freeze([
  {
    key: 'announcement', label: 'Announcement', hint: 'Hero, message, one button',
    build: (theme = 'navy') => sanitizeDesign({
      theme, subject: '', preheader: '',
      blocks: [
        b('header'),
        b('hero', { eyebrow: 'Announcement', headline: 'Something worth knowing', subhead: 'One sentence that tells them why this matters to them.' }),
        b('text', { text: 'Hi [First Name],\n\nSay what is happening, when, and what you would like them to do. Keep it to two short paragraphs.\n\nUse **bold** for the one date they must remember.' }),
        b('button', { label: 'Take the next step', url: '' }),
        b('signature'),
        b('footer'),
      ],
    }),
  },
  {
    key: 'newsletter', label: 'Newsletter', hint: 'Stories, photos, dates',
    build: (theme = 'navy') => sanitizeDesign({
      theme, subject: '', preheader: '',
      blocks: [
        b('header'),
        b('hero', { eyebrow: 'ASPIRE Newsletter', headline: 'This month at ASPIRE', subhead: 'Highlights, dates and a few people worth celebrating.' }, { pad: 'm' }),
        b('text', { text: 'Hi [First Name],\n\nA short welcome: what this issue covers and why it is worth a minute.' }),
        b('heading', { text: 'Highlights' }),
        b('columns', {
          left: { title: 'A story', text: 'Two or three sentences about something that happened.' },
          right: { title: 'Another story', text: 'Two or three sentences about something else.' },
        }),
        b('quote', { text: 'A sentence from a student, a preceptor or a leader.', cite: 'Name, Unit' }),
        b('heading', { text: 'Coming Up' }),
        b('event', { title: 'Event title', time: '', location: '' }),
        b('divider'),
        b('signature'),
        b('footer'),
      ],
    }),
  },
  {
    key: 'event', label: 'Event Invitation', hint: 'Date card and details',
    build: (theme = 'navy') => sanitizeDesign({
      theme, subject: '', preheader: '',
      blocks: [
        b('header'),
        b('hero', { eyebrow: 'You are invited', headline: 'Event title', subhead: 'One line on what they will get from coming.' }, { align: 'center' }),
        b('text', { text: 'Hi [First Name],\n\nWe would love to see you there. Here is what to expect.' }),
        b('event', { title: 'Event title', time: '5:30 to 6:30 PM', location: 'Virtual, link to follow', details: '' }),
        b('button', { label: 'Add your name', url: '' }),
        b('signature'),
        b('footer'),
      ],
    }),
  },
  {
    key: 'signup', label: 'Sign-up Form', hint: 'Opens a Catalog form',
    build: (theme = 'forest') => sanitizeDesign({
      theme, subject: '', preheader: '',
      blocks: [
        b('header'),
        b('hero', { eyebrow: 'Sign up', headline: 'Save your spot', subhead: 'It takes about two minutes.' }, { pad: 'm' }),
        b('text', { text: 'Hi [First Name],\n\nTell them what they are signing up for and by when. The button below opens a form with their own link, so their answers are filed for you.' }),
        b('steps', { items: [
          { title: 'Open the form', text: 'Use the button below.' },
          { title: 'Answer a few questions', text: 'About two minutes.' },
          { title: 'Watch for a confirmation', text: 'We will follow up by email.' },
        ] }),
        b('form', { label: 'Open the sign-up form' }),
        b('signature'),
        b('footer'),
      ],
    }),
  },
])

export const layoutFor = (key) => LAYOUTS.find(l => l.key === key) || null
