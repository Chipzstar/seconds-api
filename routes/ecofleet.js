require("dotenv").config();
const express = require("express");
const router = express.Router();

router.post("/", async (req, res) => {
	try {
		console.log(req.body)
		return res.status(200).json({
			...req.body
		})
	} catch (err) {
		console.error(err)
		return res.status(400).json({
			error: {...err}
		})
	}
})

module.exports = router;