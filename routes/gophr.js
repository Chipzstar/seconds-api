const express = require("express");
const router = express.Router();

router.post("/", async (req, res) => {
	try {
		console.log("HEADERS:", req.headers)
		console.log("BODY:", req.body)
		res.status(200).json({
			headers: { ...req.headers},
			body: {...req.body}
		})
	} catch (err) {
		console.error(err)
		res.status(400).json({
			error: {...err}
		})
	}
})

module.exports = router;