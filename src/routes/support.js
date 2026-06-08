const express = require('express');
const { body, validationResult } = require('express-validator');

const prisma = require('../config/prisma');

const router = express.Router();

function ok(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ message: errors.array()[0].msg });
    return false;
  }
  return true;
}

function mapTicket(ticket) {
  return {
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    messages: Array.isArray(ticket.messages) ? ticket.messages : [],
    lastReplyAt: ticket.lastReplyAt,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

router.get('/tickets', async (req, res, next) => {
  try {
    const tickets = await prisma.supportTicket.findMany({
      where: { userId: req.user.id },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    res.json({ tickets: tickets.map(mapTicket) });
  } catch (err) {
    next(err);
  }
});

router.post('/tickets',
  [
    body('message').trim().isLength({ min: 2 }).withMessage('Message is required.'),
    body('subject').optional().trim().isLength({ min: 2 }),
  ],
  async (req, res, next) => {
    if (!ok(req, res)) return;
    try {
      const message = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        role: 'user',
        senderName: req.user.fullName || 'Customer',
        senderEmail: req.user.email,
        body: req.body.message,
        createdAt: new Date().toISOString(),
      };
      const ticket = await prisma.supportTicket.create({
        data: {
          userId: req.user.id,
          subject: req.body.subject || 'Customer care message',
          messages: [message],
        },
      });
      res.status(201).json(mapTicket(ticket));
    } catch (err) {
      next(err);
    }
  }
);

router.post('/tickets/:id/messages',
  [body('message').trim().isLength({ min: 2 }).withMessage('Message is required.')],
  async (req, res, next) => {
    if (!ok(req, res)) return;
    try {
      const ticket = await prisma.supportTicket.findFirst({ where: { id: req.params.id, userId: req.user.id } });
      if (!ticket) return res.status(404).json({ message: 'Support ticket not found.' });
      const messages = Array.isArray(ticket.messages) ? ticket.messages : [];
      messages.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        role: 'user',
        senderName: req.user.fullName || 'Customer',
        senderEmail: req.user.email,
        body: req.body.message,
        createdAt: new Date().toISOString(),
      });
      const updated = await prisma.supportTicket.update({
        where: { id: ticket.id },
        data: { messages, status: ticket.status === 'closed' ? 'open' : ticket.status },
      });
      res.json(mapTicket(updated));
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
