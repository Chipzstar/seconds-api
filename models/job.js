const mongoose = require("mongoose");
const packageSchema = require("./package");

const jobSchema = new mongoose.Schema({
	clientId: {
		type: mongoose.Schema.Types.ObjectId,
		required: true
	},
	paymentIntentId: {
		type: String
	},
	jobSpecification: {
		id: {
			type: String,
			required: true,
		},
		shopifyId: {
			type: String,
			default: null
		},
		deliveryType: String,
		orderNumber: {
			type: String,
			unique: true,
			required: true,
		},
		packages: [packageSchema]
	},
	selectedConfiguration: {
		createdAt: Date,
		jobReference: "",
		trackingURL: "",
		deliveryFee: mongoose.Schema.Types.Number,
		winnerQuote: "",
		providerId: "",
		quotes: []
	},
	driverInformation: {
		name: {
			type: String,
			default: "Searching"
		},
		phone: {
			type: String,
			default: "Searching"
		},
		transport: {
			type: String,
			default: "Searching"
		}
	},
	createdAt: {
		type: Date,
		required: true
	},
	status: {
		type: String,
		required: true,
	}
});

const Job = mongoose.model("Job", jobSchema);

module.exports = Job;