const mongoose = require("mongoose");

const clientSchema = new mongoose.Schema({
	email: {
		type: String,
		required: true,
		unique: true
	},
	api_key: {
		type: String,
		required: true,
		unique: true
	},
	createdAt: {
		type: Date,
		default: Date.now()
	}
});

const Client = mongoose.model("Client", clientSchema);

module.exports = Client;