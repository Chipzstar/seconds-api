const mongoose = require("mongoose");

const jobSchema = new mongoose.Schema({
	jobSpecification: {
		id: String,
		orderNumber: {
			type: String,
			unique: true,
			required: true,
		},
		packages: []
	},
	selectedConfiguration: {
		createdAt: Date,
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