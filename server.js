const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Initialize the app
const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use('/uploads', express.static('uploads')); // Serve uploaded files

// MongoDB connection
mongoose.connect('mongodb://localhost:27017/food_ordering', { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Ensure uploads directory exists
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}



// Define Schemas
const foodItemSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  name: { type: String, required: true },
  image: { type: String, default: true },
  price: { type: Number, required: true },
  description: { type: String, required: true },
  type: { type: String, required: true },
});

const orderSchema = new mongoose.Schema({
  userDetails: {
      name: String,
      email: String
      
  },
  orderDetails: [
      {
          foodName: String,
          foodPrice: Number,
          quantity: Number
      }
  ],
  totalAmount: Number,
  paymentMethod: String,
  status: {
    type: String,
    enum: ['Pending', 'Delivered', 'Rejected'], // Enum for order status
    default: 'Pending'
  }
}, { timestamps: true });

// User Schema
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  mobile: { type: String, required: false, unique: true },
  email: { type: String, required: false, unique: true },
  password: { type: String, required: true },
  profileImage: { type: String, required: false }
});

// Create Models
const FoodItem = mongoose.model('FoodItem', foodItemSchema);
const Order = mongoose.model('Order', orderSchema);
const User = mongoose.model('User', userSchema);

const JWT_SECRET = 'dc5e41e784f5ba8ce43921796f63300d056dc05dde9630afeef50249a2294863ac92a11433ac5c9e44215e694282ba2b1c11001b78000463c6bac5910415a841';

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // Limit file size to 1MB
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb('Error: Images Only!');
    }
  }
});

// Middleware to protect routes
const authenticateJWT = (req, res, next) => {
  const token = req.header('Authorization')?.split(' ')[1];
  if (!token) return res.status(401).send('Access denied');

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).send('Invalid token');
    req.user = user;
    next();
  });
};

// **Food Items Routes**

app.get('/food-items', async (req, res) => {
  try {
    const foodItems = await FoodItem.find();
    res.json(foodItems);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching food items', error });
  }
});

app.post('/food-items', upload.single('image'), async (req, res) => {
  console.log('Request Body:', req.body); // Log the request body
  console.log('Uploaded File:', req.file); // Log the uploaded file

  try {
      const { name, price, description, type } = req.body;
      const imagePath = req.file?.path; // Use optional chaining in case the file is not present

      // Validate that all required fields are present
      if (!name || !price || !description || !type || !imagePath) {
          return res.status(400).json({ message: 'All fields are required' });
      }

      const newFoodItem = new FoodItem({
          name,
          price,
          description,
          type,
          image: imagePath // Save the image path in the database
      });

      await newFoodItem.save();
      res.status(201).json(newFoodItem);
  } catch (error) {
      res.status(400).json({ message: 'Error adding food item', error });
  }
});


app.delete('/food-items/:id', async (req, res) => {
  try {
    const deletedFoodItem = await FoodItem.findByIdAndDelete(req.params.id);
    if (!deletedFoodItem) {
      return res.status(404).json({ message: 'Food item not found' });
    }
    res.json({ message: 'Food item deleted', deletedFoodItem });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting food item', error });
  }
});

app.post('/api/uploadImage', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }
  res.send(`File uploaded: ${req.file.path}`);
});

// **Orders Routes**

app.get('/orders', authenticateJWT, async (req, res) => {
  try {
    const email = req.user.email;  // Extract the email from the authenticated user (JWT)
    // Find the orders associated with the logged-in user's email
    const orders = await Order.find({ 'userDetails.email': email }).sort({ createdAt: -1 });
    
    if (!orders || orders.length === 0) {
      return res.status(404).json({ message: 'No orders found for this user' });
    }

    res.json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ message: 'Error fetching orders', error });
  }
});

app.get('/allorders', async (req, res) => {
  try {
    const allOrders = await Order.find().sort({ createdAt: -1 });

    if (!allOrders || allOrders.length === 0) {
      return res.status(404).json({ message: 'No orders found' });
    }

    res.json(allOrders);
  } catch (error) {
    console.error('Error fetching all orders:', error);
    res.status(500).json({ message: 'Error fetching all orders', error });
  }
});



app.post('/orders', async (req, res) => {
  try {
      const { userDetails, orderDetails, totalAmount, paymentMethod } = req.body;

      // Debugging: Print the received data
      console.log('Received data:', req.body);

      // Create a new order document
      const newOrder = new Order({
          userDetails,
          orderDetails,
          totalAmount,
          paymentMethod,
          status: 'Pending'
      });

      // Save the order to the database
      await newOrder.save();

      // Send a success response
      res.status(201).json({ message: 'Order submitted successfully' });
  } catch (error) {
      // Send an error response
      console.error('Error submitting order:', error);
      res.status(500).json({ message: 'Failed to submit order' });
  }
});

app.put('/orders/:id', async (req, res) => {
  try {
    const { status } = req.body;

    // Validate that the status is one of the allowed options
    if (!['Pending', 'Delivered', 'Rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    // Find and update the order by its ID
    const updatedOrder = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true } // Return the updated document
    );

    // If the order was not found, return a 404 error
    if (!updatedOrder) {
      return res.status(404).json({ message: `Order with ID ${req.params.id} not found` });
    }

    // Respond with the updated order details
    res.status(200).json(updatedOrder);

  } catch (error) {
    // Log the error for debugging
    console.error('Error updating order:', error);

    // Send a 500 error for general failures
    res.status(500).json({ message: 'Error updating order', error });
  }
});


app.delete('/orders/:id', async (req, res) => {
  try {
    const deletedOrder = await Order.findByIdAndDelete(req.params.id);
    if (!deletedOrder) {
      return res.status(404).json({ message: 'Order not found' });
    }
    res.json({ message: 'Order deleted', deletedOrder });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting order', error });
  }
});

// **User Routes (Sign-Up, Sign-In, Profile)**

app.post('/signup', upload.single('profileImage'), async (req, res) => {
  const { name, mobile, email, password } = req.body;
  try {
    const existingUser = await User.findOne({ $or: [{ email }, { mobile }] });
    if (existingUser) {
      return res.status(400).send('Email or mobile number already in use');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      name,
      mobile,
      email,
      password: hashedPassword,
      profileImage: req.file ? req.file.path : null // Store the path to the uploaded image
    });
    await user.save();

    // Create a token
    const token = jwt.sign({ email: user.email }, JWT_SECRET); // Ensure JWT_SECRET is defined

    // Send response with token
    res.status(201).json({ token, name: user.name, email: user.email });
  } catch (err) {
    console.error('Error registering user:', err);
    res.status(500).send('Error registering user');
  }
});


app.post('/adminsignup', upload.single('profileImage'), async (req, res) => {
  const { name, mobile, email, password } = req.body;
  try {
    const existingUser = await User.findOne({ $or: [{ email }, { mobile }] });
    if (existingUser) {
      return res.status(400).send('Email or mobile number already in use');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      name,
      mobile,
      email,
      password: hashedPassword,
      profileImage: req.file ? req.file.path : null // Store the path to the uploaded image
    });
    await user.save();

    // Create a token
    const token = jwt.sign({ email: user.email }, JWT_SECRET); // Ensure JWT_SECRET is defined

    // Send response with token
    res.status(201).json({ token, name: user.name, email: user.email });
  } catch (err) {
    console.error('Error registering user:', err);
    res.status(500).send('Error registering user');
  }
});





// Sign-In Route
app.post('/signin', async (req, res) => {
  const { identifier, password } = req.body; // 'identifier' could be email or mobile
  try {
    const user = await User.findOne({
      $or: [{ email: identifier }, { mobile: identifier }]
    });

    if (!user) return res.status(401).send('Invalid credentials');

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).send('Invalid credentials');

    const token = jwt.sign({ email: user.email }, JWT_SECRET);
    res.json({ token, name: user.name, email: user.email });
  } catch (err) {
    res.status(500).send('Error signing in');
  }
});

app.post('/adminsignin', async (req, res) => {
  const { identifier, password } = req.body; // 'identifier' could be email or mobile
  try {
    const user = await User.findOne({
      $or: [{ email: identifier }, { mobile: identifier }]
    });

    if (!user) return res.status(401).send('Invalid credentials');

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).send('Invalid credentials');

    const token = jwt.sign({ email: user.email }, JWT_SECRET);
    res.json({ token, name: user.name, email: user.email });
  } catch (err) {
    res.status(500).send('Error signing in');
  }
});



// **Profile Route** (Fetch user details)
app.get('/profile', authenticateJWT, async (req, res) => {
  try {
    // Fetch the user by email stored in the token
    const user = await User.findOne({ email: req.user.email }).select('-password'); // Exclude password

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (err) {
    console.error('Error fetching user profile:', err);
    res.status(500).json({ message: 'Error fetching user profile', error: err });
  }
});

// Protected Route example
app.get('/protected', authenticateJWT, (req, res) => {
  res.send('This is a protected route');
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
