import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useState, useEffect } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface ExamData {
  id: string;
  name: string;
  score: number;
  timestamp: number;
  creator: string;
  isVerified: boolean;
  decryptedValue: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [exams, setExams] = useState<ExamData[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingExam, setCreatingExam] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newExamData, setNewExamData] = useState({ name: "", score: "" });
  const [selectedExam, setSelectedExam] = useState<ExamData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ visible: true, status: "error", message: "FHEVM initialization failed" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };
    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadData = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      try {
        const contract = await getContractReadOnly();
        if (!contract) return;
        setContractAddress(await contract.getAddress());
        const businessIds = await contract.getAllBusinessIds();
        const examsList: ExamData[] = [];
        for (const businessId of businessIds) {
          const businessData = await contract.getBusinessData(businessId);
          examsList.push({
            id: businessId,
            name: businessData.name,
            score: Number(businessData.publicValue1) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        }
        setExams(examsList);
      } catch (error) {
        setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [isConnected]);

  const createExam = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    setCreatingExam(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating exam with FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("No contract");
      const scoreValue = parseInt(newExamData.score) || 0;
      const businessId = `exam-${Date.now()}`;
      const encryptedResult = await encrypt(contractAddress, address, scoreValue);
      const tx = await contract.createBusinessData(
        businessId,
        newExamData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        scoreValue,
        0,
        "Exam Score"
      );
      await tx.wait();
      setTransactionStatus({ visible: true, status: "success", message: "Exam created!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      setShowCreateModal(false);
      setNewExamData({ name: "", score: "" });
      const updatedExams = [...exams, {
        id: businessId,
        name: newExamData.name,
        score: scoreValue,
        timestamp: Math.floor(Date.now() / 1000),
        creator: address,
        isVerified: false,
        decryptedValue: 0
      }];
      setExams(updatedExams);
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected") 
        ? "Transaction rejected" 
        : "Creation failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingExam(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        return Number(businessData.decryptedValue) || 0;
      }
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      setTransactionStatus({ visible: true, status: "success", message: "Decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      return Number(clearValue);
    } catch (e: any) { 
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
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
        setTransactionStatus({ visible: true, status: "success", message: "System is available" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredExams = exams.filter(exam => 
    exam.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <h1>ExamSafe FHE</h1>
          <ConnectButton />
        </header>
        <div className="connection-prompt">
          <h2>Connect Wallet to Start</h2>
          <p>Secure your exam scores with FHE encryption</p>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted exams...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>ExamSafe FHE</h1>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Exam
          </button>
          <ConnectButton />
        </div>
      </header>

      <div className="main-content">
        <div className="dashboard-section">
          <div className="stats-panel">
            <div className="stat-item">
              <h3>Total Exams</h3>
              <p>{exams.length}</p>
            </div>
            <div className="stat-item">
              <h3>Verified</h3>
              <p>{exams.filter(e => e.isVerified).length}</p>
            </div>
            <div className="stat-item">
              <h3>Avg Score</h3>
              <p>{exams.length > 0 ? (exams.reduce((sum, e) => sum + e.score, 0) / exams.length).toFixed(1) : 0}</p>
            </div>
          </div>

          <div className="search-bar">
            <input 
              type="text" 
              placeholder="Search exams..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <button onClick={checkAvailability} className="check-btn">
              Check System
            </button>
          </div>
        </div>

        <div className="exams-list">
          {filteredExams.length === 0 ? (
            <div className="no-exams">
              <p>No exams found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Create First Exam
              </button>
            </div>
          ) : (
            filteredExams.map((exam, index) => (
              <div 
                key={index} 
                className={`exam-item ${exam.isVerified ? "verified" : ""}`}
                onClick={() => setSelectedExam(exam)}
              >
                <div className="exam-name">{exam.name}</div>
                <div className="exam-meta">
                  <span>Score: {exam.score}</span>
                  <span>{new Date(exam.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="exam-status">
                  {exam.isVerified ? "✅ Verified" : "🔓 Pending"}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-exam-modal">
            <div className="modal-header">
              <h2>New Exam</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-modal">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Exam Name</label>
                <input 
                  type="text" 
                  value={newExamData.name}
                  onChange={(e) => setNewExamData({...newExamData, name: e.target.value})}
                  placeholder="Enter exam name"
                />
              </div>
              <div className="form-group">
                <label>Score (FHE Encrypted)</label>
                <input 
                  type="number" 
                  value={newExamData.score}
                  onChange={(e) => setNewExamData({...newExamData, score: e.target.value})}
                  placeholder="Enter score (0-100)"
                  min="0"
                  max="100"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">
                Cancel
              </button>
              <button 
                onClick={createExam} 
                disabled={creatingExam || isEncrypting || !newExamData.name || !newExamData.score}
                className="submit-btn"
              >
                {creatingExam || isEncrypting ? "Creating..." : "Create Exam"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedExam && (
        <div className="modal-overlay">
          <div className="exam-detail-modal">
            <div className="modal-header">
              <h2>Exam Details</h2>
              <button onClick={() => setSelectedExam(null)} className="close-modal">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="exam-info">
                <div className="info-item">
                  <span>Name:</span>
                  <strong>{selectedExam.name}</strong>
                </div>
                <div className="info-item">
                  <span>Creator:</span>
                  <strong>{selectedExam.creator.substring(0, 6)}...{selectedExam.creator.substring(38)}</strong>
                </div>
                <div className="info-item">
                  <span>Date:</span>
                  <strong>{new Date(selectedExam.timestamp * 1000).toLocaleDateString()}</strong>
                </div>
                <div className="info-item">
                  <span>Public Score:</span>
                  <strong>{selectedExam.score}</strong>
                </div>
              </div>

              <div className="encrypted-section">
                <h3>Encrypted Score</h3>
                <div className="encrypted-value">
                  {selectedExam.isVerified ? (
                    <div className="verified-score">
                      <span>Verified Score:</span>
                      <strong>{selectedExam.decryptedValue}</strong>
                    </div>
                  ) : (
                    <div className="encrypted-placeholder">
                      <span>🔒 FHE Encrypted</span>
                      <button 
                        onClick={async () => {
                          const decrypted = await decryptData(selectedExam.id);
                          if (decrypted !== null) {
                            setSelectedExam({
                              ...selectedExam,
                              decryptedValue: decrypted,
                              isVerified: true
                            });
                          }
                        }}
                        disabled={isDecrypting}
                        className="decrypt-btn"
                      >
                        {isDecrypting ? "Decrypting..." : "Decrypt"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setSelectedExam(null)} className="close-btn">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="transaction-notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            {transactionStatus.status === "pending" && <div className="spinner"></div>}
            {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
            {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;