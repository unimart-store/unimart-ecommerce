const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const { RETENTION_AFTER_READ_DAYS } = require("../models/Notification");

const DAY_MS = 24 * 60 * 60 * 1000;

const clampInt = (value, fallback, min, max) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

// What a client may see. No recipient id, no delivery/channel internals.
const toClient = (n) => ({
  id: String(n._id),
  type: n.type,
  title: n.title,
  message: n.message,
  data: n.data || {},
  readAt: n.readAt || null,
  createdAt: n.createdAt,
});

/**
 * One set of handlers per audience. The recipient is ALWAYS the authenticated
 * user (req.user, set by `protect`) - a recipient id from the browser is never
 * read. Every query is scoped to that user AND the audience type, so a user can
 * only ever list, count or mark their OWN notifications.
 */
const makeHandlers = (recipientType) => {
  // Only notifications shown in the bell / list (in-app channel on).
  const scope = (req) => ({ recipientId: req.user._id, recipientType, "channels.inApp.status": "delivered" });

  const countUnread = (req) => Notification.countDocuments({ ...scope(req), readAt: null });

  return {
    // GET  ?page=1&limit=20&unread=true
    list: async (req, res, next) => {
      try {
        const page = clampInt(req.query.page, 1, 1, 100000);
        const limit = clampInt(req.query.limit, 20, 1, 50); // hard cap: never unbounded
        const filter = scope(req);
        if (req.query.unread === "true") filter.readAt = null;

        const [items, total, unreadCount] = await Promise.all([
          Notification.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .select("type title message data readAt createdAt")
            .lean(),
          Notification.countDocuments(filter),
          countUnread(req),
        ]);

        res.set("Cache-Control", "no-store");
        res.status(200).json({
          success: true,
          data: items.map(toClient),
          pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
          unreadCount,
        });
      } catch (error) {
        next(error);
      }
    },

    // GET
    unreadCount: async (req, res, next) => {
      try {
        res.set("Cache-Control", "no-store");
        res.status(200).json({ success: true, data: { unreadCount: await countUnread(req) } });
      } catch (error) {
        next(error);
      }
    },

    // PATCH /:id/read  - idempotent; 404 for "not yours" and "doesn't exist" alike
    markRead: async (req, res, next) => {
      try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
          return res.status(404).json({ success: false, message: "Notification not found" });
        }
        const now = new Date();
        const updated = await Notification.findOneAndUpdate(
          { _id: req.params.id, ...scope(req), readAt: null },
          { $set: { readAt: now, expiresAt: new Date(now.getTime() + RETENTION_AFTER_READ_DAYS * DAY_MS) } },
          { new: true }
        ).lean();

        if (!updated) {
          // Already read (fine - idempotent) or not the caller's / missing.
          const existing = await Notification.findOne({ _id: req.params.id, ...scope(req) }).select("type title message data readAt createdAt").lean();
          if (!existing) return res.status(404).json({ success: false, message: "Notification not found" });
          return res.status(200).json({ success: true, data: toClient(existing), unreadCount: await countUnread(req) });
        }
        res.status(200).json({ success: true, data: toClient(updated), unreadCount: await countUnread(req) });
      } catch (error) {
        next(error);
      }
    },

    // PATCH /read-all
    markAllRead: async (req, res, next) => {
      try {
        const now = new Date();
        const result = await Notification.updateMany(
          { ...scope(req), readAt: null },
          { $set: { readAt: now, expiresAt: new Date(now.getTime() + RETENTION_AFTER_READ_DAYS * DAY_MS) } }
        );
        res.status(200).json({ success: true, data: { updated: result.modifiedCount || 0, unreadCount: 0 } });
      } catch (error) {
        next(error);
      }
    },
  };
};

exports.admin = makeHandlers("admin");
exports.customer = makeHandlers("customer");
exports.toClient = toClient;
