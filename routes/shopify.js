require("dotenv").config();
const express = require("express");
const db = require("../models");
const router = express.Router();

router.post('/', async (req, res) => {
	try {
		console.log("-----------------------------")
		console.log(req.body)
		console.log("-----------------------------")
		res.status(200).json({
			status: "SUCCESS",
			message: "webhook received"
		})
	} catch (err) {
		console.error(err)
		res.status(500).json({
			error: { ...err }
		})
	}
})

module.exports = router;