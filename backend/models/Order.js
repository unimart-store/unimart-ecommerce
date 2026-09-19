const mongoose = require("mongoose");
const crypto = require("crypto");

const orderSchema = new mongoose.Schema({

    orderId:{
        type:String,
        required:true,
        unique:true,
        index:true
    },

    // Optional - present for logged-in checkouts, absent for guest orders.
    // Guest checkout must remain fully supported, so this is never required.
    user:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"User",
        required:false,
        index:true
    },

    customerName:{
        type:String,
        required:true,
        trim:true
    },

    customerPhone:{
        type:String,
        required:true,
        trim:true
    },

    customerAddress:{
        type:String,
        required:true,
        trim:true
    },

    // Additive (Phase 1): set by the SERVER from business config, never taken
    // blindly from the client. Existing orders simply don't have it.
    customerCountry:{
        type:String,
        default:"Nepal"
    },

    items:[
        {
            productId:{
                type:mongoose.Schema.Types.ObjectId,
                ref:"Product"
            },

            name:{
                type:String,
                required:true
            },

            quantity:{
                type:Number,
                required:true,
                min:1
            },

            price:{
                type:Number,
                required:true
            }
        }
    ],

    totalAmount:{
        type:Number,
        required:true
    },

    // Kept as a plain String (no schema enum) so historical orders with any
    // older value still load and save. The allowed set for NEW orders is
    // enforced in the backend validator (config/business.js paymentMethods).
    paymentMethod:{
        type:String,
        default:"WhatsApp"
    },

    // Where the order came from. Server-set only. "whatsapp" is reserved for
    // the future official WhatsApp Cloud API flow (Phase 4).
    source:{
        type:String,
        enum:["website","whatsapp"],
        default:"website"
    },

    status:{
        type:String,
        default:"Pending",
        enum:[
            "Pending",
            "Processing",
            "Shipped",
            "Delivered",
            "Cancelled"
        ],
        index:true
    },

    paymentStatus:{
        type:String,
        default:"Unpaid",
        enum:[
            "Unpaid",
            "Paid",
            "Failed"
        ]
    },

    // ---- Idempotency (duplicate-order protection) ----
    // The storefront sends one random key per intentional checkout attempt.
    // (scope, key) is unique, so the same attempt can never create two orders
    // even under concurrent/retried requests. scope = "user:<id>" or "guest",
    // so a key can never collide across different customers.
    idempotencyScope:{
        type:String,
        select:false
    },
    idempotencyKey:{
        type:String
    },
    // Hash of what the customer intended to order; lets a replayed key be
    // checked ("same key, different order" is rejected, not silently merged).
    idempotencyFingerprint:{
        type:String,
        select:false
    },

    // ---- Cancellation audit ----
    // stockRestoredAt is written in the SAME atomic update that flips the
    // status to Cancelled, and only orders that were not yet Cancelled can
    // match that update - so stock is returned at most once per order.
    cancelledAt:{
        type:Date
    },
    stockRestoredAt:{
        type:Date
    }

},{
    timestamps:true
});

// Real uniqueness constraint behind the idempotency guarantee. Partial, so
// existing orders (no key) and callers that send no key are unaffected.
orderSchema.index(
    { idempotencyScope: 1, idempotencyKey: 1 },
    { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);

// Internal bookkeeping never leaves the server.
orderSchema.set("toJSON", {
    transform: (doc, ret) => {
        delete ret.idempotencyScope;
        delete ret.idempotencyFingerprint;
        return ret;
    }
});

// AUTO orderId generator (PRODUCTION SAFE)
// Runs in pre("validate"), not pre("save") - orderId is required, and
// validation runs BEFORE pre("save") hooks fire.
// No `next` parameter - Mongoose 9's hook execution doesn't support the old
// callback-style next() the way earlier versions did. Same fix already
// applied to User.js's password-hashing hook.
orderSchema.pre("validate", function () {
    if (!this.orderId) {
        // Same "ORD-<ms>-<suffix>" shape as before; the suffix is now 16 bits
        // of crypto randomness instead of 0-999, making same-millisecond
        // collisions ~65x less likely.
        this.orderId = "ORD-" + Date.now() + "-" + crypto.randomBytes(2).toString("hex").toUpperCase();
    }
});

module.exports = mongoose.model("Order", orderSchema);
