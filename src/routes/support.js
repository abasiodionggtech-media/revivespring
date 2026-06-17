const express = require('express');
const { body, validationResult } = require('express-validator');
const { sendSupportInboxEmail } = require('../services/email');

const {
  addUserTicketMessage,
  createSupportTicket,
  findUserTicket,
  listUserTickets,
} = require('../services/supportStorage');

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
    const tickets = await listUserTickets(req.user.id, 50);
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
      const ticket = await createSupportTicket({
        user: req.user,
        subject: req.body.subject,
        message: req.body.message,
      });
      try {
        await sendSupportInboxEmail(ticket, req.user, req.body.message);
      } catch (err) {
        console.error(`[EMAIL] Support inbox email failed for ${req.user.email}:`, err.message);
      }
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
      const ticket = await findUserTicket(req.params.id, req.user.id);
      if (!ticket) return res.status(404).json({ message: 'Support ticket not found.' });
      const updated = await addUserTicketMessage({
        ticket,
        user: req.user,
        message: req.body.message,
      });
      res.json(mapTicket(updated));
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
