# Tic-Tac-Toe Game
# Main entry point

from board import Board
from player import Player, HumanPlayer, AIPlayer
import random

def main():
    print("=== Tic-Tac-Toe ===")
    print("1. PvP (Player vs Player)")
    print("2. PvE (Player vs AI)")
    
    choice = input("Select mode (1/2): ").strip()
    
    if choice == "1":
        player1 = HumanPlayer("X")
        player2 = HumanPlayer("O")
    else:
        player1 = HumanPlayer("X")
        player2 = AIPlayer("O")
    
    board = Board()
    current_player = player1
    
    board.print_board()
    
    while not board.is_full():
        print(f"\nPlayer {current_player.symbol}'s turn")
        move = current_player.get_move(board)
        
        if board.make_move(move, current_player.symbol):
            board.print_board()
            
            if board.check_winner(current_player.symbol):
                print(f"Player {current_player.symbol} wins!")
                break
            
            if board.is_full():
                print("It's a draw!")
                break
        
        current_player = player2 if current_player == player1 else player1
    
    print("\nGame Over!")

if __name__ == "__main__":
    main()
