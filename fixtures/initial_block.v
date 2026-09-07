module initial_block (
    input  wire       clk,
    output reg  [3:0] count
);

    // Flaw: initial block is ignored by synthesis.
    initial begin
        count = 4'b0000;
    end

    always @(posedge clk) begin
        count <= count + 4'b0001;
    end

endmodule
