const mongoose = require('mongoose');

exports.userPointSchema = new mongoose.Schema({
	type: {
		type: String,
		enum: ['Point'],
		required: true,
		default: 'Point'
	},
	coordinates: {
		type: [Number],
		required: true,
	}
});

exports.jobPointSchema = new mongoose.Schema({
	type: {
		type: String,
		enum: ['Point'],
		required: true,
		default: 'Point'
	},
	coordinates: {
		type: [Number],
		required: true,
	}
}, {_id: false});