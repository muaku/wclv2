const mongoose = require("mongoose")
const Schema = mongoose.Schema

const MicroSchema = Schema({
    heart: Number,
    breath: Number,
    motion: Number,
    created_at: { type: String }
})

module.exports.micro = mongoose.model("micro", MicroSchema, "micro")