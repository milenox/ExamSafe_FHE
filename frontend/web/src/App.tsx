import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface ExamData {
  id: string;
  name: string;
  description: string;
  creator: string;
  timestamp: number;
  encryptedScore: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedScore?: number;
}

interface ExamStats {
  totalExams: number;
  verifiedExams: number;
  avgScore: number;
  highScore: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [exams, setExams] = useState<ExamData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingExam, setCreatingExam] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newExamData, setNewExamData] = useState({ name: "", description: "", score: "" });
  const [selectedExam, setSelectedExam] = useState<ExamData | null>(null);
  const [decryptedScore, setDecryptedScore] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [stats, setStats] = useState<ExamStats>({ totalExams: 0, verifiedExams: 0, avgScore: 0, highScore: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const examsList: ExamData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          examsList.push({
            id: businessId,
            name: businessData.name,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            encryptedScore: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedScore: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading exam data:', e);
        }
      }
      
      setExams(examsList);
      calculateStats(examsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const calculateStats = (examsList: ExamData[]) => {
    const totalExams = examsList.length;
    const verifiedExams = examsList.filter(e => e.isVerified).length;
    
    const verifiedScores = examsList
      .filter(e => e.isVerified && e.decryptedScore !== undefined)
      .map(e => e.decryptedScore as number);
    
    const avgScore = verifiedScores.length > 0 
      ? verifiedScores.reduce((sum, score) => sum + score, 0) / verifiedScores.length 
      : 0;
    
    const highScore = verifiedScores.length > 0 
      ? Math.max(...verifiedScores) 
      : 0;
    
    setStats({ totalExams, verifiedExams, avgScore, highScore });
  };

  const createExam = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingExam(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating exam with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract");
      
      const scoreValue = parseInt(newExamData.score) || 0;
      const businessId = `exam-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, scoreValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newExamData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newExamData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Confirming transaction..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Exam created!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewExamData({ name: "", description: "", score: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingExam(false); 
    }
  };

  const decryptScore = async (examId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const examData = await contractRead.getBusinessData(examId);
      if (examData.isVerified) {
        const storedValue = Number(examData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Score already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(examId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(examId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Score decrypted!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Score already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "System available!" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Availability check failed" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderStatsPanel = () => {
    return (
      <div className="stats-panel">
        <div className="stat-item">
          <div className="stat-label">Total Exams</div>
          <div className="stat-value">{stats.totalExams}</div>
        </div>
        <div className="stat-item">
          <div className="stat-label">Verified</div>
          <div className="stat-value">{stats.verifiedExams}</div>
        </div>
        <div className="stat-item">
          <div className="stat-label">Avg Score</div>
          <div className="stat-value">{stats.avgScore.toFixed(1)}</div>
        </div>
        <div className="stat-item">
          <div className="stat-label">High Score</div>
          <div className="stat-value">{stats.highScore}</div>
        </div>
      </div>
    );
  };

  const renderScoreChart = (score: number) => {
    return (
      <div className="score-chart">
        <div className="chart-bar" style={{ height: `${score}%` }}>
          <div className="chart-value">{score}</div>
        </div>
        <div className="chart-label">Score</div>
      </div>
    );
  };

  const renderLeaderboard = () => {
    const verifiedExams = exams
      .filter(e => e.isVerified && e.decryptedScore !== undefined)
      .sort((a, b) => (b.decryptedScore || 0) - (a.decryptedScore || 0))
      .slice(0, 5);
    
    return (
      <div className="leaderboard">
        <h3>Top Scores</h3>
        {verifiedExams.length > 0 ? (
          <ul>
            {verifiedExams.map((exam, index) => (
              <li key={index} className="leaderboard-item">
                <span className="rank">{index + 1}</span>
                <span className="name">{exam.name}</span>
                <span className="score">{exam.decryptedScore}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No verified scores yet</p>
        )}
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>ExamSafe FHE 🔐</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Wallet to Start</h2>
            <p>Secure your exam scores with fully homomorphic encryption</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Initialize FHE system</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Create and grade exams privately</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE System...</p>
        <p>Status: {fhevmInitializing ? "Initializing FHEVM" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading exam data...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>ExamSafe FHE 🔐</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Exam
          </button>
          <button 
            onClick={checkAvailability} 
            className="status-btn"
          >
            Check System
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content">
        <div className="left-panel">
          <div className="panel-section">
            <h2>Exam Statistics</h2>
            {renderStatsPanel()}
          </div>
          
          <div className="panel-section">
            <h2>Top Scores</h2>
            {renderLeaderboard()}
          </div>
        </div>
        
        <div className="center-panel">
          <div className="panel-section">
            <div className="section-header">
              <h2>Exam Records</h2>
              <div className="header-actions">
                <button 
                  onClick={loadData} 
                  className="refresh-btn" 
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="exams-list">
              {exams.length === 0 ? (
                <div className="no-exams">
                  <p>No exams found</p>
                  <button 
                    className="create-btn" 
                    onClick={() => setShowCreateModal(true)}
                  >
                    Create First Exam
                  </button>
                </div>
              ) : exams.map((exam, index) => (
                <div 
                  className={`exam-item ${selectedExam?.id === exam.id ? "selected" : ""} ${exam.isVerified ? "verified" : ""}`} 
                  key={index}
                  onClick={() => setSelectedExam(exam)}
                >
                  <div className="exam-title">{exam.name}</div>
                  <div className="exam-meta">
                    <span>Creator: {exam.creator.substring(0, 6)}...{exam.creator.substring(38)}</span>
                    <span>Date: {new Date(exam.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  <div className="exam-status">
                    {exam.isVerified ? (
                      <span className="verified">✅ Verified Score: {exam.decryptedScore}</span>
                    ) : (
                      <span className="pending">🔓 Pending Verification</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        
        <div className="right-panel">
          <div className="panel-section">
            <h2>About ExamSafe</h2>
            <div className="about-content">
              <p>ExamSafe uses fully homomorphic encryption (FHE) to securely grade exams without exposing student scores.</p>
              <div className="fhe-flow">
                <div className="flow-step">
                  <div className="step-icon">1</div>
                  <div className="step-content">
                    <h4>Encrypt Answers</h4>
                    <p>Student answers are encrypted before submission</p>
                  </div>
                </div>
                <div className="flow-step">
                  <div className="step-icon">2</div>
                  <div className="step-content">
                    <h4>Homomorphic Grading</h4>
                    <p>Scores calculated on encrypted data</p>
                  </div>
                </div>
                <div className="flow-step">
                  <div className="step-icon">3</div>
                  <div className="step-content">
                    <h4>Secure Results</h4>
                    <p>Only authorized parties can decrypt final scores</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateExam 
          onSubmit={createExam} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingExam} 
          examData={newExamData} 
          setExamData={setNewExamData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedExam && (
        <ExamDetailModal 
          exam={selectedExam} 
          onClose={() => { 
            setSelectedExam(null); 
            setDecryptedScore(null); 
          }} 
          decryptedScore={decryptedScore} 
          setDecryptedScore={setDecryptedScore} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptScore={() => decryptScore(selectedExam.id)}
          renderScoreChart={renderScoreChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateExam: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  examData: any;
  setExamData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, examData, setExamData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'score') {
      const intValue = value.replace(/[^\d]/g, '');
      setExamData({ ...examData, [name]: intValue });
    } else {
      setExamData({ ...examData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-exam-modal">
        <div className="modal-header">
          <h2>New Exam</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Exam scores encrypted with Zama FHE (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Exam Name *</label>
            <input 
              type="text" 
              name="name" 
              value={examData.name} 
              onChange={handleChange} 
              placeholder="Enter exam name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={examData.description} 
              onChange={handleChange} 
              placeholder="Enter exam description..." 
            />
          </div>
          
          <div className="form-group">
            <label>Score (Integer only) *</label>
            <input 
              type="number" 
              name="score" 
              value={examData.score} 
              onChange={handleChange} 
              placeholder="Enter score..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !examData.name || !examData.score} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Exam"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ExamDetailModal: React.FC<{
  exam: ExamData;
  onClose: () => void;
  decryptedScore: number | null;
  setDecryptedScore: (value: number | null) => void;
  isDecrypting: boolean;
  decryptScore: () => Promise<number | null>;
  renderScoreChart: (score: number) => JSX.Element;
}> = ({ exam, onClose, decryptedScore, setDecryptedScore, isDecrypting, decryptScore, renderScoreChart }) => {
  const handleDecrypt = async () => {
    if (decryptedScore !== null) { 
      setDecryptedScore(null); 
      return; 
    }
    
    const decrypted = await decryptScore();
    if (decrypted !== null) {
      setDecryptedScore(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="exam-detail-modal">
        <div className="modal-header">
          <h2>Exam Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="exam-info">
            <div className="info-item">
              <span>Exam Name:</span>
              <strong>{exam.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{exam.creator.substring(0, 6)}...{exam.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(exam.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="description-section">
            <h3>Description</h3>
            <p>{exam.description || "No description provided"}</p>
          </div>
          
          <div className="score-section">
            <h3>Exam Score</h3>
            
            <div className="score-display">
              {exam.isVerified ? (
                <div className="verified-score">
                  <div className="score-value">{exam.decryptedScore}</div>
                  <div className="score-label">Verified Score</div>
                </div>
              ) : decryptedScore !== null ? (
                <div className="decrypted-score">
                  <div className="score-value">{decryptedScore}</div>
                  <div className="score-label">Decrypted Score</div>
                </div>
              ) : (
                <div className="encrypted-score">
                  <div className="score-icon">🔒</div>
                  <div className="score-label">FHE Encrypted</div>
                </div>
              )}
              
              <button 
                className={`decrypt-btn ${(exam.isVerified || decryptedScore !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Decrypting..."
                ) : exam.isVerified ? (
                  "✅ Verified"
                ) : decryptedScore !== null ? (
                  "🔄 Re-decrypt"
                ) : (
                  "🔓 Decrypt Score"
                )}
              </button>
            </div>
            
            {(exam.isVerified || decryptedScore !== null) && (
              <div className="score-chart-container">
                {renderScoreChart(exam.isVerified ? exam.decryptedScore || 0 : decryptedScore || 0)}
              </div>
            )}
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>Fully Homomorphic Encryption</strong>
                <p>Score calculated on encrypted data without decryption</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!exam.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


