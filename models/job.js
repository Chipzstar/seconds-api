const mongoose = require("mongoose");

const jobSchema = new mongoose.Schema({
	jobSpecification: {
		id: Number,
		orderNumber: {
			type: String,
			unique: true,
			required: true,
		},
		packages: []
	},
	selectedConfiguration: {
		clientReferenceNumber: "",
		createdAt: Date,
		jobReference: "",
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
});

const Job = mongoose.model("Job", jobSchema);

module.exports = Job;