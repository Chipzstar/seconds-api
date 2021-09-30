const mongoose = require("mongoose");
const packageSchema = require("./package");

const jobSchema = new mongoose.Schema({
	jobSpecification: {
		id: String,
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
		delivery: "",
		winnerQuote: "",
		providerId: "",
		quotes: []
	},
	createdAt: {
		type: Date,
		required: true
	},
	status: {
		type: String,
		required: true,
	},
	paymentIntentId: {
		type: String,
		required: true
	}
});

const Job = mongoose.model("Job", jobSchema);

module.exports = Job;