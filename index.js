const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs').promises;  // Add this line
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS
app.use(cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('Error connecting to MongoDB:', err));

// Set up Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });
// User Schema
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { type: String, unique: true },
  userType: { type: String, enum: ['individual', 'company'], required: true },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  dials: [{amount: { type: Number, default: 0,  }, time: { type: Date, default: Date.now }}],
  pickUps: [{amount: { type: Number, default: 0,  }, time: { type: Date, default: Date.now }}],
  closes: [{amount: { type: Number, default: 0,  }, time: { type: Date, default: Date.now }}]
});

const CompanySchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true },
  password: { type: String, required: true },
  employees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  invites: [{ 
    email: String, 
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' } 
  }]
});

const Company = mongoose.model('Company', CompanySchema);

const User = mongoose.model('User', UserSchema);

const CallSchema = new mongoose.Schema({
  audioPath: { type: String, required: true },
  analysis: { type: String },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now }
});

const Call = mongoose.model('Call', CallSchema);

const EmployeeAnalysisSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  strengths: String,
  weaknesses: String,
  consistencies: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const EmployeeAnalysis = mongoose.model('EmployeeAnalysis', EmployeeAnalysisSchema);

app.get('/calls', async (req, res) => {
  const userId = req.query.userId; // Assume the userId is sent as a query parameter
  if (!userId) {
    return res.status(400).json({ message: 'User ID is required' });
  }

  try {
    const calls = await Call.find({ userId: userId }).sort({ createdAt: -1 });
    console.log('Fetched calls:', calls);
    res.json(calls);
  } catch (error) {
    console.error('Error fetching calls:', error);
    res.status(500).json({ message: 'Error fetching calls', error: error.message });
  }
});

app.post('/upload', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  const userId = req.body.userId;
  if (!userId) {
    return res.status(400).send('User ID is required.');
  }

  try {
    const newCall = new Call({
      audioPath: req.file.path,
      userId: userId
    });

    await newCall.save();

    // Run Python script
    const pythonProcess = spawn('python', ['model.py', req.file.path]);

    pythonProcess.stdout.on('data', (data) => {
      console.log(`Python script output: ${data}`);
    });

    pythonProcess.stderr.on('data', (data) => {
      console.error(`Python script error: ${data}`);
    });

    pythonProcess.on('close', async (code) => {
      console.log(`Python script exited with code ${code}`);
    
      if (code === 0) {
        try {
          // Read the analysis results
          const analysisResults = await fs.readFile('agent_outputs.txt', 'utf8');
    
          // Update the call document with the analysis results
          newCall.analysis = analysisResults;
          await newCall.save();
    
          res.status(201).json({
            message: 'File uploaded and analyzed successfully',
            callId: newCall._id,
            analysis: analysisResults
          });
        } catch (error) {
          console.error('Error reading analysis results:', error);
          res.status(500).json({ message: 'Error reading analysis results', error: error.message });
        }
      } else {
        res.status(500).json({ message: 'Error during analysis' });
      }
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ message: 'Error uploading file', error: error.message });
  }
});

app.post('/register', async (req, res) => {
  console.log('Received registration request:', req.body);
  const { username, password, email, userType, companyName } = req.body;

  try {
      // Check if user already exists
      const existingUser = await User.findOne({ $or: [{ username }, { email }] });
      if (existingUser) {
          return res.status(400).json({ message: 'User already exists' });
      }

      // Hash the password
      const hashedPassword = await bcrypt.hash(password, 10);

      if (userType === 'individual') {
          // Create individual user
          const newUser = new User({
              username,
              password: hashedPassword,
              email,
              userType
          });
          await newUser.save();
          res.status(201).json({ message: 'Individual user registered successfully', userId: newUser._id });
      } else if (userType === 'company') {
          // Check if company already exists
          const existingCompany = await Company.findOne({ email });
          if (existingCompany) {
              return res.status(400).json({ message: 'Company already exists' });
          }

          // Create company
          const newCompany = new Company({
              name: companyName,
              email,
              password: hashedPassword
          });
          await newCompany.save();

          // Create company admin user
          const newUser = new User({
              username,
              password: hashedPassword,
              email,
              userType,
              companyId: newCompany._id
          });
          await newUser.save();

          // Add admin user to company's employees
          newCompany.employees.push(newUser._id);
          await newCompany.save();

          res.status(201).json({ message: 'Company registered successfully', companyId: newCompany._id, userId: newUser._id });
      } else {
          res.status(400).json({ message: 'Invalid user type' });
      }
  } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ message: 'Error registering user', error: error.message });
  }
});

app.post('/login', async (req, res) => {
  const { username, password, userType } = req.body;

  try {
    let user;
    if (userType === 'company') {
      user = await Company.findOne({ name: username });
    } else {
      user = await User.findOne({ username });
    }

    if (!user) {
      return res.status(400).json({ message: 'Invalid username or password' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { 
        userId: user._id, 
        username: userType === 'company' ? user.name : user.username,
        userType 
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({ 
      message: 'Login successful', 
      token,
      userId: user._id,
      username: userType === 'company' ? user.name : user.username,
      userType
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Error during login', error: error.message });
  }
});

app.post('/invite-employee', async (req, res) => {
  const { companyId, employeeEmail } = req.body;

  try {
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    // Check if the email is already invited
    const existingInvite = company.invites.find(invite => invite.email === employeeEmail);
    if (existingInvite) {
      return res.status(400).json({ message: 'Invitation already sent to this email' });
    }

    company.invites.push({ email: employeeEmail });
    await company.save();

    res.status(200).json({ message: 'Invitation sent successfully' });
  } catch (error) {
    console.error('Error inviting employee:', error);
    res.status(500).json({ message: 'Error inviting employee', error: error.message });
  }
});

app.post('/handle-invitation', async (req, res) => {
  const { userId, companyId, status } = req.body;

  try {
    const company = await Company.findById(companyId);
    const user = await User.findById(userId);

    if (!company || !user) {
      return res.status(404).json({ message: 'Company or User not found' });
    }

    const inviteIndex = company.invites.findIndex(invite => invite.email === user.email);
    if (inviteIndex === -1) {
      return res.status(404).json({ message: 'Invitation not found' });
    }

    company.invites[inviteIndex].status = status;

    if (status === 'accepted') {
      company.employees.push(userId);
      user.companyId = companyId;
      await user.save();
    }

    await company.save();

    res.status(200).json({ message: 'Invitation handled successfully' });
  } catch (error) {
    console.error('Error handling invitation:', error);
    res.status(500).json({ message: 'Error handling invitation', error: error.message });
  }
});

app.get('/company-invites/:companyId', async (req, res) => {
  const { companyId } = req.params;

  try {
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    res.status(200).json(company.invites);
  } catch (error) {
    console.error('Error fetching company invites:', error);
    res.status(500).json({ message: 'Error fetching company invites', error: error.message });
  }
});

app.get('/user-invites/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const invites = await Company.find({ 'invites.email': user.email, 'invites.status': 'pending' });
    res.status(200).json(invites);
  } catch (error) {
    console.error('Error fetching user invites:', error);
    res.status(500).json({ message: 'Error fetching user invites', error: error.message });
  }
});

app.get('/company/:companyId/employees', async (req, res) => {
  const { companyId } = req.params;

  try {
    const company = await Company.findById(companyId).populate('employees', 'username email');
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    res.status(200).json(company.employees);
  } catch (error) {
    console.error('Error fetching company employees:', error);
    res.status(500).json({ message: 'Error fetching company employees', error: error.message });
  }
});

app.get('/employee-calls/:employeeId', async (req, res) => {
  const { employeeId } = req.params;

  try {
    const calls = await Call.find({ userId: employeeId }).sort({ createdAt: -1 });
    res.status(200).json(calls);
  } catch (error) {
    console.error('Error fetching employee calls:', error);
    res.status(500).json({ message: 'Error fetching employee calls', error: error.message });
  }
});

app.get('/employee-analysis/:employeeId', async (req, res) => {
  const { employeeId } = req.params;

  try {
    const analysis = await EmployeeAnalysis.findOne({ employeeId });
    console.log("fetching analysis")
    if (!analysis) {
      return res.status(404).json({ message: 'Analysis not found for this employee' });
    }
    res.status(200).json(analysis);
  } catch (error) {
    console.error('Error fetching employee analysis:', error);
    res.status(500).json({ message: 'Error fetching employee analysis', error: error.message });
  }
});

app.post('/analyze-employee/:employeeId', async (req, res) => {
  const { employeeId } = req.params;

  try {
    // Fetch all calls for the employee
    const calls = await Call.find({ userId: employeeId });

    if (calls.length === 0) {
      return res.status(404).json({ message: 'No calls found for this employee' });
    }

    // Spawn Python process
    const pythonProcess = spawn('python', ['employee_analysis.py']);

    let outputData = '';
    let errorData = '';

    // Send calls data to the Python script
    pythonProcess.stdin.write(JSON.stringify(calls));
    pythonProcess.stdin.end();

    // Collect output from the Python script
    pythonProcess.stdout.on('data', (data) => {
      outputData += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      errorData += data.toString();
    });

    pythonProcess.on('close', async (code) => {
      if (code !== 0) {
        console.error(`Python script exited with code ${code}`);
        console.error(`Error output: ${errorData}`);
        return res.status(500).json({ message: 'Error during analysis' });
      }

      try {
        const analysisResult = JSON.parse(outputData);

        // Save or update the analysis in the database
        await EmployeeAnalysis.findOneAndUpdate(
          { employeeId },
          {
            ...analysisResult,
            updatedAt: new Date()
          },
          { upsert: true, new: true }
        );

        res.status(200).json(analysisResult);
      } catch (error) {
        console.error('Error parsing analysis result:', error);
        console.error('Raw output:', outputData);
        res.status(500).json({ message: 'Error parsing analysis result', error: error.message });
      }
    });
  } catch (error) {
    console.error('Error analyzing employee:', error);
    res.status(500).json({ message: 'Error analyzing employee', error: error.message });
  }
});

// Start the server
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try a different port.`);
  } else {
    console.error('Error starting server:', err);
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  server.close(() => {
    console.log('Server closed. Database connections should be closed as well.');
    process.exit(0);
  });
});